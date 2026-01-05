import { Injectable } from '@nestjs/common';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, Hex, Address, Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, polygon, base, bsc, gnosis, sepolia } from 'viem/chains';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EvmUtil } from '../evm.util';

// ERC20 ABI
const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

// SimpleDelegation Contract ABI - minimal ERC-7821 BatchExecutor
// This contract allows executing arbitrary calls when delegated via EIP-7702
const SIMPLE_DELEGATION_ABI = parseAbi([
  'function execute((address to, uint256 value, bytes data)[] calls) external payable',
]);

// SimpleDelegation Contract - minimal EIP-7702 batch executor without access control
// Deployed on Sepolia: 0x824ee1dffe5220dc4dc7c3b82a31c1e86bafd37a
// TODO: Deploy on mainnet and other chains with same bytecode using CREATE2
// Source: /tmp/SimpleDelegation.sol - executes calls in the context of the delegating EOA
const SIMPLE_DELEGATION_ADDRESS = '0x824ee1dffe5220dc4dc7c3b82a31c1e86bafd37a' as Address;

// Chain configuration
const CHAIN_CONFIG: Partial<
  Record<Blockchain, { chain: Chain; configKey: string; prefix: string; pimlicoName: string }>
> = {
  [Blockchain.ETHEREUM]: { chain: mainnet, configKey: 'ethereum', prefix: 'eth', pimlicoName: 'ethereum' },
  [Blockchain.ARBITRUM]: { chain: arbitrum, configKey: 'arbitrum', prefix: 'arbitrum', pimlicoName: 'arbitrum' },
  [Blockchain.OPTIMISM]: { chain: optimism, configKey: 'optimism', prefix: 'optimism', pimlicoName: 'optimism' },
  [Blockchain.POLYGON]: { chain: polygon, configKey: 'polygon', prefix: 'polygon', pimlicoName: 'polygon' },
  [Blockchain.BASE]: { chain: base, configKey: 'base', prefix: 'base', pimlicoName: 'base' },
  [Blockchain.BINANCE_SMART_CHAIN]: { chain: bsc, configKey: 'bsc', prefix: 'bsc', pimlicoName: 'binance' },
  [Blockchain.GNOSIS]: { chain: gnosis, configKey: 'gnosis', prefix: 'gnosis', pimlicoName: 'gnosis' },
  [Blockchain.SEPOLIA]: { chain: sepolia, configKey: 'sepolia', prefix: 'sepolia', pimlicoName: 'sepolia' },
};

export interface Eip7702Authorization {
  chainId: number;
  address: string;
  nonce: number;
  r: string;
  s: string;
  yParity: number;
}

export interface GaslessTransferResult {
  txHash: string;
  userOpHash: string;
}

@Injectable()
export class PimlicoBundlerService {
  private readonly logger = new DfxLogger(PimlicoBundlerService);
  private readonly config = GetConfig().blockchain;

  private get apiKey(): string | undefined {
    return this.config.evm.pimlicoApiKey;
  }

  /**
   * Check if gasless transactions are supported for the blockchain
   */
  isGaslessSupported(blockchain: Blockchain): boolean {
    if (!this.apiKey) return false;
    return CHAIN_CONFIG[blockchain] !== undefined;
  }

  /**
   * Check if user has zero native balance (needs gasless)
   */
  async hasZeroNativeBalance(userAddress: string, blockchain: Blockchain): Promise<boolean> {
    const chainConfig = this.getChainConfig(blockchain);
    if (!chainConfig) return false;

    try {
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrl),
      });

      const balance = await publicClient.getBalance({ address: userAddress as Address });
      return balance === 0n;
    } catch (error) {
      this.logger.warn(`Failed to check native balance for ${userAddress} on ${blockchain}: ${error.message}`);
      return false;
    }
  }

  /**
   * Prepare EIP-7702 authorization data for frontend signing
   *
   * EIP-7702 Flow:
   * 1. User signs authorization to delegate SimpleDelegation contract to their EOA
   * 2. Relayer sends TX to USER's EOA (not token contract!)
   * 3. The delegated contract's execute() function runs in EOA's context
   * 4. Token transfer happens FROM the user's EOA
   */
  async prepareAuthorizationData(
    userAddress: string,
    blockchain: Blockchain,
  ): Promise<{
    contractAddress: string;
    chainId: number;
    nonce: number;
    typedData: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  }> {
    const chainConfig = this.getChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`Blockchain ${blockchain} not supported for gasless transactions`);
    }

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const nonce = Number(await publicClient.getTransactionCount({ address: userAddress as Address }));

    // EIP-7702 Authorization: delegate SimpleDelegation contract to user's EOA
    // When TX is sent to the EOA, it executes the delegated contract's code
    const typedData = {
      domain: {
        chainId: chainConfig.chain.id,
      },
      types: {
        Authorization: [
          { name: 'chainId', type: 'uint256' },
          { name: 'address', type: 'address' },
          { name: 'nonce', type: 'uint256' },
        ],
      },
      primaryType: 'Authorization',
      message: {
        chainId: chainConfig.chain.id,
        address: SIMPLE_DELEGATION_ADDRESS,
        nonce: nonce,
      },
    };

    return {
      contractAddress: SIMPLE_DELEGATION_ADDRESS,
      chainId: chainConfig.chain.id,
      nonce,
      typedData,
    };
  }

  /**
   * Execute gasless transfer using EIP-7702 + Pimlico Paymaster
   *
   * This uses the existing EIP-7702 delegation service approach:
   * 1. User signs EIP-7702 authorization to delegate to a smart contract
   * 2. DFX relayer submits the transaction with the authorization
   * 3. Pimlico-sponsored gas (via DFX's Pimlico account)
   */
  async executeGaslessTransfer(
    userAddress: string,
    token: Asset,
    recipient: string,
    amount: number,
    authorization: Eip7702Authorization,
  ): Promise<GaslessTransferResult> {
    const blockchain = token.blockchain;

    if (!this.isGaslessSupported(blockchain)) {
      throw new Error(`Gasless transactions not supported for ${blockchain}`);
    }

    const chainConfig = this.getChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`No chain config found for ${blockchain}`);
    }

    this.logger.verbose(
      `Executing gasless transfer: ${amount} ${token.name} from ${userAddress} to ${recipient} on ${blockchain}`,
    );

    try {
      // Use the EIP-7702 delegation approach with DFX relayer
      const txHash = await this.executeViaRelayer(userAddress, token, recipient, amount, authorization, chainConfig);

      this.logger.info(
        `Gasless transfer successful on ${blockchain}: ${amount} ${token.name} to ${recipient} | TX: ${txHash}`,
      );

      return { txHash, userOpHash: txHash };
    } catch (error) {
      this.logger.error(`Gasless transfer failed on ${blockchain}:`, error);
      throw new Error(`Gasless transfer failed: ${error.message}`);
    }
  }

  /**
   * Execute transfer via DFX relayer with EIP-7702 authorization
   *
   * CRITICAL: EIP-7702 Transaction Structure
   * - `to` field MUST be the USER's EOA address (not the token contract!)
   * - `data` field calls the delegated contract's execute() function
   * - The execute() function runs in the EOA's context via delegation
   * - Token transfer happens FROM the user because msg.sender = EOA
   */
  private async executeViaRelayer(
    userAddress: string,
    token: Asset,
    recipient: string,
    amount: number,
    authorization: Eip7702Authorization,
    chainConfig: { chain: Chain; rpcUrl: string },
  ): Promise<string> {
    // Get relayer account (pays gas fees)
    const relayerPrivateKey = this.getRelayerPrivateKey(token.blockchain);
    const relayerAccount = privateKeyToAccount(relayerPrivateKey);

    // Create clients
    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    // Encode ERC20 transfer call
    const amountWei = BigInt(EvmUtil.toWeiAmount(amount, token.decimals).toString());
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipient as Address, amountWei],
    });

    // Build the call for SimpleDelegation.execute()
    // This is an array of (to, value, data) tuples
    const calls = [
      {
        to: token.chainId as Address, // Token contract address
        value: 0n,
        data: transferData,
      },
    ];

    // Encode the execute() call that will run on the user's EOA
    const executeData = encodeFunctionData({
      abi: SIMPLE_DELEGATION_ABI,
      functionName: 'execute',
      args: [calls],
    });

    // Convert authorization to viem format
    const viemAuthorization = {
      chainId: BigInt(authorization.chainId),
      address: authorization.address as Address,
      nonce: BigInt(authorization.nonce),
      r: authorization.r as Hex,
      s: authorization.s as Hex,
      yParity: authorization.yParity,
    };

    // Estimate gas
    const block = await publicClient.getBlock();
    const maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    const maxFeePerGas = block.baseFeePerGas
      ? block.baseFeePerGas * 2n + maxPriorityFeePerGas
      : maxPriorityFeePerGas * 2n;

    // Use fixed gas limit for EIP-7702 transactions
    const gasLimit = 200000n;

    // Get relayer's nonce
    const nonce = await publicClient.getTransactionCount({ address: relayerAccount.address });

    // Build EIP-7702 transaction
    // CRITICAL: 'to' is the USER's EOA, not the token contract!
    // The authorizationList delegates SimpleDelegation to the EOA
    // The 'data' (execute call) runs in the EOA's context
    const transaction = {
      from: relayerAccount.address as Address,
      to: userAddress as Address, // ✅ CORRECT: Target is USER's EOA
      data: executeData, // ✅ CORRECT: execute([{to: token, data: transfer(...)}])
      value: 0n,
      nonce,
      chainId: chainConfig.chain.id,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      authorizationList: [viemAuthorization],
      type: 'eip7702' as const,
    };

    this.logger.verbose(
      `EIP-7702 TX: from=${relayerAccount.address} to=${userAddress} (EOA) | ` +
        `Token transfer: ${amount} ${token.name} to ${recipient}`,
    );

    // Sign and broadcast
    const signedTx = await walletClient.signTransaction(transaction as any);
    const txHash = await walletClient.sendRawTransaction({ serializedTransaction: signedTx as `0x${string}` });

    return txHash;
  }

  /**
   * Get chain configuration
   */
  private getChainConfig(blockchain: Blockchain): { chain: Chain; rpcUrl: string } | undefined {
    const config = CHAIN_CONFIG[blockchain];
    if (!config) return undefined;

    const chainConfig = this.config[config.configKey];
    const rpcUrl = `${chainConfig[`${config.prefix}GatewayUrl`]}/${chainConfig[`${config.prefix}ApiKey`] ?? ''}`;

    return { chain: config.chain, rpcUrl };
  }

  /**
   * Get Pimlico bundler URL
   */
  private getPimlicoUrl(blockchain: Blockchain): string {
    const chainConfig = CHAIN_CONFIG[blockchain];
    if (!chainConfig) throw new Error(`No chain config for ${blockchain}`);
    return `https://api.pimlico.io/v2/${chainConfig.pimlicoName}/rpc?apikey=${this.apiKey}`;
  }

  /**
   * Get relayer private key for the blockchain
   */
  private getRelayerPrivateKey(blockchain: Blockchain): Hex {
    const config = CHAIN_CONFIG[blockchain];
    if (!config) throw new Error(`No config found for ${blockchain}`);

    const key = this.config[config.configKey][`${config.prefix}WalletPrivateKey`];
    if (!key) throw new Error(`No relayer private key configured for ${blockchain}`);

    return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
  }
}
