import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { parseAbi, decodeFunctionData, Hex, Chain } from 'viem';
import { privateKeyToAccount, signMessage } from 'viem/accounts';
import { mainnet, arbitrum, optimism, polygon, base, bsc, gnosis, sepolia } from 'viem/chains';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';
import { PaymasterRpcRequest, PaymasterRpcResponse, PaymasterStubDataResponse, PaymasterDataResponse } from './dto/paymaster.dto';

// ERC20 transfer ABI for decoding calldata
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

// Chain configuration
const CHAIN_CONFIG: Partial<Record<number, { chain: Chain; blockchain: Blockchain; configKey: string; prefix: string }>> = {
  [1]: { chain: mainnet, blockchain: Blockchain.ETHEREUM, configKey: 'ethereum', prefix: 'eth' },
  [42161]: { chain: arbitrum, blockchain: Blockchain.ARBITRUM, configKey: 'arbitrum', prefix: 'arbitrum' },
  [10]: { chain: optimism, blockchain: Blockchain.OPTIMISM, configKey: 'optimism', prefix: 'optimism' },
  [137]: { chain: polygon, blockchain: Blockchain.POLYGON, configKey: 'polygon', prefix: 'polygon' },
  [8453]: { chain: base, blockchain: Blockchain.BASE, configKey: 'base', prefix: 'base' },
  [56]: { chain: bsc, blockchain: Blockchain.BINANCE_SMART_CHAIN, configKey: 'bsc', prefix: 'bsc' },
  [100]: { chain: gnosis, blockchain: Blockchain.GNOSIS, configKey: 'gnosis', prefix: 'gnosis' },
  [11155111]: { chain: sepolia, blockchain: Blockchain.SEPOLIA, configKey: 'sepolia', prefix: 'sepolia' },
};

@Injectable()
export class PaymasterService {
  private readonly logger = new DfxLogger(PaymasterService);
  private readonly config = GetConfig().blockchain;

  constructor(
    @Inject(forwardRef(() => DepositService))
    private readonly depositService: DepositService,
  ) {}

  /**
   * Handle ERC-7677 JSON-RPC request
   */
  async handleRpcRequest(chainId: number, request: PaymasterRpcRequest): Promise<PaymasterRpcResponse> {
    const { method, params, id, jsonrpc } = request;

    try {
      let result: any;

      switch (method) {
        case 'pm_getPaymasterStubData':
          result = await this.getPaymasterStubData(chainId, params);
          break;
        case 'pm_getPaymasterData':
          result = await this.getPaymasterData(chainId, params);
          break;
        default:
          return {
            jsonrpc,
            error: { code: -32601, message: `Method not found: ${method}` },
            id,
          };
      }

      return { jsonrpc, result, id };
    } catch (error) {
      this.logger.error(`Paymaster RPC error for ${method}:`, error);
      return {
        jsonrpc,
        error: {
          code: -32000,
          message: error.message || 'Internal paymaster error',
        },
        id,
      };
    }
  }

  /**
   * pm_getPaymasterStubData - Returns stub data for gas estimation
   * Called during transaction preparation
   */
  private async getPaymasterStubData(chainId: number, params: any[]): Promise<PaymasterStubDataResponse> {
    const [userOp, entryPoint, context] = params;

    // Validate the transaction
    await this.validateUserOperation(chainId, userOp, context);

    // Get paymaster address for this chain
    const paymasterAddress = this.getPaymasterAddress(chainId);

    // Return stub data for gas estimation
    // The actual paymaster data will be provided in pm_getPaymasterData
    return {
      paymaster: paymasterAddress,
      paymasterData: '0x', // Stub data - will be replaced with real signature
      paymasterVerificationGasLimit: '0x30000', // 200k gas for verification
      paymasterPostOpGasLimit: '0x10000', // 65k gas for post-op
      isFinal: false, // Not final - will call pm_getPaymasterData for actual data
    };
  }

  /**
   * pm_getPaymasterData - Returns signed paymaster data
   * Called right before transaction submission
   */
  private async getPaymasterData(chainId: number, params: any[]): Promise<PaymasterDataResponse> {
    const [userOp, entryPoint, context] = params;

    // Validate the transaction again
    await this.validateUserOperation(chainId, userOp, context);

    // Get paymaster address and private key
    const paymasterAddress = this.getPaymasterAddress(chainId);
    const paymasterPrivateKey = this.getPaymasterPrivateKey(chainId);

    // Sign the UserOperation for the Paymaster
    // This signature proves that DFX approves sponsoring this transaction
    const paymasterData = await this.signUserOperation(chainId, userOp, paymasterPrivateKey);

    this.logger.info(`Sponsoring transaction on chain ${chainId} for sender ${userOp.sender}`);

    return {
      paymaster: paymasterAddress,
      paymasterData,
    };
  }

  /**
   * Validate that we should sponsor this UserOperation
   * Only sponsor transfers to valid DFX deposit addresses
   */
  private async validateUserOperation(chainId: number, userOp: any, context?: any): Promise<void> {
    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig) {
      throw new BadRequestException(`Unsupported chain: ${chainId}`);
    }

    // Decode the calldata to find the transfer recipient
    const recipient = await this.extractTransferRecipient(userOp.callData);
    if (!recipient) {
      throw new BadRequestException('Could not decode transfer recipient from callData');
    }

    // Validate that recipient is a valid DFX deposit address
    const isValidDeposit = await this.isValidDfxDepositAddress(recipient);
    if (!isValidDeposit) {
      throw new BadRequestException('Only transfers to DFX deposit addresses are sponsored');
    }

    this.logger.verbose(`Validated transaction: recipient ${recipient} is a valid DFX deposit address`);
  }

  /**
   * Extract the transfer recipient from callData
   * Handles both direct ERC20 transfer and batched calls
   */
  private async extractTransferRecipient(callData: string): Promise<string | null> {
    try {
      // Try to decode as ERC20 transfer
      const decoded = decodeFunctionData({
        abi: ERC20_ABI,
        data: callData as Hex,
      });

      if (decoded.functionName === 'transfer' && decoded.args) {
        return decoded.args[0] as string;
      }
    } catch {
      // Not a direct ERC20 transfer, might be batched
      // TODO: Handle batched calls (ERC-7579 execute format)
    }

    // Try to parse as ERC-7579 execution data
    // Format: target (20 bytes) + value (32 bytes) + callData
    if (callData.length >= 106) {
      // 0x + 40 (address) + 64 (uint256)
      try {
        const innerCallData = ('0x' + callData.slice(106)) as Hex;
        const decoded = decodeFunctionData({
          abi: ERC20_ABI,
          data: innerCallData,
        });

        if (decoded.functionName === 'transfer' && decoded.args) {
          return decoded.args[0] as string;
        }
      } catch {
        // Could not decode
      }
    }

    return null;
  }

  /**
   * Check if address is a valid DFX deposit address
   */
  private async isValidDfxDepositAddress(address: string): Promise<boolean> {
    return this.depositService.isValidDepositAddress(address);
  }

  /**
   * Sign UserOperation with paymaster private key
   * This creates a signature that the on-chain Paymaster contract will verify
   */
  private async signUserOperation(chainId: number, userOp: any, privateKey: Hex): Promise<string> {
    const account = privateKeyToAccount(privateKey);

    // Create a hash of the UserOperation fields that matter for paymaster
    // This is a simplified version - real implementation needs proper ERC-4337 hash
    const message = JSON.stringify({
      sender: userOp.sender,
      nonce: userOp.nonce,
      callData: userOp.callData,
      chainId,
      validUntil: Math.floor(Date.now() / 1000) + 3600, // Valid for 1 hour
    });

    const signature = await signMessage({
      privateKey,
      message,
    });

    // Encode validUntil + validAfter + signature
    const validUntil = Math.floor(Date.now() / 1000) + 3600;
    const validAfter = 0;

    // Pack: validUntil (6 bytes) + validAfter (6 bytes) + signature
    const paymasterData =
      '0x' +
      validUntil.toString(16).padStart(12, '0') +
      validAfter.toString(16).padStart(12, '0') +
      signature.slice(2);

    return paymasterData;
  }

  /**
   * Get paymaster contract address for chain
   * TODO: Deploy actual paymaster contracts and configure addresses
   */
  private getPaymasterAddress(chainId: number): string {
    // For now, use the relayer address as paymaster
    // In production, this should be a deployed VerifyingPaymaster contract
    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig) throw new Error(`No config for chain ${chainId}`);

    const config = this.config[chainConfig.configKey];
    const privateKey = config[`${chainConfig.prefix}WalletPrivateKey`];
    if (!privateKey) throw new Error(`No private key configured for chain ${chainId}`);

    const account = privateKeyToAccount((privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as Hex);
    return account.address;
  }

  /**
   * Get paymaster private key for signing
   */
  private getPaymasterPrivateKey(chainId: number): Hex {
    const chainConfig = CHAIN_CONFIG[chainId];
    if (!chainConfig) throw new Error(`No config for chain ${chainId}`);

    const config = this.config[chainConfig.configKey];
    const key = config[`${chainConfig.prefix}WalletPrivateKey`];
    if (!key) throw new Error(`No paymaster private key configured for chain ${chainId}`);

    return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
  }
}
