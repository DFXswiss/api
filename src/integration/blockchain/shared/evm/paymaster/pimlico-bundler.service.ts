import { Injectable } from '@nestjs/common';
import { createPublicClient, encodeFunctionData, http, parseAbi, Hex, Address, toHex, concat, pad } from 'viem';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { EvmUtil } from '../evm.util';
import ERC20_ABI from '../abi/erc20.abi.json';
import { EVM_CHAIN_CONFIG, getEvmChainConfig, isEvmBlockchainSupported } from '../evm-chain.config';

// MetaMask EIP7702StatelessDeleGator - deployed on ALL major EVM chains
// This contract implements ERC-7821 execute() with onlyEntryPointOrSelf modifier
// Source: https://github.com/MetaMask/delegation-framework
const METAMASK_DELEGATOR_ADDRESS = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b' as Address;

// ERC-4337 EntryPoint v0.7 - canonical address on all chains
const ENTRY_POINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address;

// EIP-7702 factory marker - signals to bundler that this is an EIP-7702 UserOperation
const EIP7702_FACTORY = '0x0000000000000000000000000000000000007702' as Address;

// MetaMask Delegator ABI - ERC-7821 BatchExecutor interface
const DELEGATOR_ABI = parseAbi(['function execute((bytes32 mode, bytes executionData) execution) external payable']);

// ERC-7821 execution mode for batch calls
// BATCH_CALL mode: 0x0100... (first byte = 0x01 for batch)
const BATCH_CALL_MODE = '0x0100000000000000000000000000000000000000000000000000000000000000' as Hex;

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

interface UserOperationV07 {
  sender: Address;
  nonce: Hex;
  factory: Address;
  factoryData: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster: Address;
  paymasterVerificationGasLimit: Hex;
  paymasterPostOpGasLimit: Hex;
  paymasterData: Hex;
  signature: Hex;
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
    return isEvmBlockchainSupported(blockchain);
  }

  /**
   * Check if user has zero native balance (needs gasless)
   */
  async hasZeroNativeBalance(userAddress: string, blockchain: Blockchain): Promise<boolean> {
    const chainConfig = getEvmChainConfig(blockchain);
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
   * EIP-7702 + ERC-4337 Flow:
   * 1. User signs authorization to delegate MetaMask Delegator to their EOA
   * 2. Backend creates UserOperation with the signed authorization
   * 3. Pimlico Bundler submits via EntryPoint with Paymaster sponsorship
   * 4. EntryPoint validates authorization and calls execute() on user's EOA
   * 5. Token transfer happens FROM the user's EOA
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
    const chainConfig = getEvmChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`Blockchain ${blockchain} not supported for gasless transactions`);
    }

    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const nonce = Number(await publicClient.getTransactionCount({ address: userAddress as Address }));

    // EIP-7702 Authorization: delegate MetaMask Delegator to user's EOA
    // The Delegator's execute() function has onlyEntryPointOrSelf modifier
    // This ensures only EntryPoint (ERC-4337) or the EOA itself can call it
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
        address: METAMASK_DELEGATOR_ADDRESS,
        nonce: nonce,
      },
    };

    return {
      contractAddress: METAMASK_DELEGATOR_ADDRESS,
      chainId: chainConfig.chain.id,
      nonce,
      typedData,
    };
  }

  /**
   * Execute gasless transfer using EIP-7702 + ERC-4337 via Pimlico
   *
   * Flow:
   * 1. User has already signed EIP-7702 authorization for MetaMask Delegator
   * 2. We create an ERC-4337 UserOperation with factory=0x7702
   * 3. Pimlico Bundler validates and submits to EntryPoint
   * 4. Pimlico Paymaster sponsors the gas
   * 5. EntryPoint calls execute() on the user's EOA (via delegation)
   * 6. Token transfer executes FROM the user's address
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

    const chainConfig = getEvmChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`No chain config found for ${blockchain}`);
    }

    this.logger.verbose(
      `Executing gasless transfer via Pimlico: ${amount} ${token.name} from ${userAddress} to ${recipient} on ${blockchain}`,
    );

    try {
      const result = await this.executeViaPimlico(userAddress, token, recipient, amount, authorization, blockchain);

      this.logger.info(
        `Gasless transfer successful on ${blockchain}: ${amount} ${token.name} to ${recipient} | ` +
          `UserOpHash: ${result.userOpHash} | TX: ${result.txHash}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Gasless transfer failed on ${blockchain}:`, error);
      throw new Error(`Gasless transfer failed: ${error.message}`);
    }
  }

  /**
   * Execute transfer via Pimlico Bundler with EIP-7702 + ERC-4337
   */
  private async executeViaPimlico(
    userAddress: string,
    token: Asset,
    recipient: string,
    amount: number,
    authorization: Eip7702Authorization,
    blockchain: Blockchain,
  ): Promise<GaslessTransferResult> {
    const pimlicoUrl = this.getPimlicoUrl(blockchain);

    // 1. Encode the ERC20 transfer call
    const amountWei = BigInt(EvmUtil.toWeiAmount(amount, token.decimals).toString());
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipient as Address, amountWei],
    });

    // 2. Encode the execute() call for MetaMask Delegator (ERC-7821 format)
    const callData = this.encodeExecuteCall(token.chainId as Address, transferData);

    // 3. Encode the EIP-7702 authorization as factoryData
    const factoryData = this.encodeAuthorizationAsFactoryData(authorization);

    // 4. Build the UserOperation
    const userOp = await this.buildUserOperation(userAddress as Address, callData, factoryData, pimlicoUrl);

    // 5. Sponsor the UserOperation via Pimlico Paymaster
    const sponsoredUserOp = await this.sponsorUserOperation(userOp, pimlicoUrl);

    // 6. Submit the UserOperation via Pimlico Bundler
    const userOpHash = await this.sendUserOperation(sponsoredUserOp, pimlicoUrl);

    // 7. Wait for the transaction to be mined
    const txHash = await this.waitForUserOperation(userOpHash, pimlicoUrl);

    return { txHash, userOpHash };
  }

  /**
   * Encode execute() call for MetaMask Delegator (ERC-7821 format)
   */
  private encodeExecuteCall(tokenAddress: Address, transferData: Hex): Hex {
    // ERC-7821 executionData format for batch calls:
    // abi.encode(Call[]) where Call = (address target, uint256 value, bytes data)
    const calls = [
      {
        target: tokenAddress,
        value: 0n,
        data: transferData,
      },
    ];

    // Encode calls array
    const encodedCalls = this.encodeCalls(calls);

    // Encode full execute() call with mode and executionData
    return encodeFunctionData({
      abi: DELEGATOR_ABI,
      functionName: 'execute',
      args: [{ mode: BATCH_CALL_MODE, executionData: encodedCalls }],
    });
  }

  /**
   * Encode calls array for ERC-7821
   */
  private encodeCalls(calls: Array<{ target: Address; value: bigint; data: Hex }>): Hex {
    // Manual ABI encoding for Call[] since viem doesn't have a direct method
    // Format: abi.encode((address,uint256,bytes)[])
    const call = calls[0];
    const encoded = concat([
      pad(toHex(32n), { size: 32 }), // offset to array
      pad(toHex(BigInt(calls.length)), { size: 32 }), // array length
      pad(call.target, { size: 32 }), // target address
      pad(toHex(call.value), { size: 32 }), // value
      pad(toHex(96n), { size: 32 }), // offset to bytes data
      pad(toHex(BigInt((call.data.length - 2) / 2)), { size: 32 }), // bytes length
      call.data as Hex, // actual data
    ]);

    return encoded;
  }

  /**
   * Encode EIP-7702 authorization as factoryData for UserOperation
   *
   * When factory = 0x7702, the bundler expects factoryData to contain
   * the signed EIP-7702 authorization that delegates the smart account
   * implementation to the EOA.
   */
  private encodeAuthorizationAsFactoryData(authorization: Eip7702Authorization): Hex {
    // factoryData format for EIP-7702:
    // abi.encodePacked(address delegatee, uint256 nonce, bytes signature)
    // where signature = abi.encodePacked(r, s, yParity)
    const signature = concat([
      authorization.r as Hex,
      authorization.s as Hex,
      toHex(authorization.yParity, { size: 1 }),
    ]);

    return concat([
      authorization.address as Hex, // delegatee (MetaMask Delegator)
      pad(toHex(BigInt(authorization.nonce)), { size: 32 }), // nonce
      signature, // signature (r, s, yParity)
    ]);
  }

  /**
   * Build UserOperation v0.7 structure
   */
  private async buildUserOperation(
    sender: Address,
    callData: Hex,
    factoryData: Hex,
    pimlicoUrl: string,
  ): Promise<UserOperationV07> {
    // Get current gas prices from Pimlico
    const gasPrice = await this.getGasPrice(pimlicoUrl);

    // Get sender nonce from EntryPoint
    const nonce = await this.getSenderNonce(sender, pimlicoUrl);

    const userOp: UserOperationV07 = {
      sender,
      nonce: toHex(nonce),
      factory: EIP7702_FACTORY,
      factoryData,
      callData,
      callGasLimit: toHex(200000n),
      verificationGasLimit: toHex(500000n),
      preVerificationGas: toHex(100000n),
      maxFeePerGas: toHex(gasPrice.maxFeePerGas),
      maxPriorityFeePerGas: toHex(gasPrice.maxPriorityFeePerGas),
      paymaster: '0x0000000000000000000000000000000000000000' as Address,
      paymasterVerificationGasLimit: toHex(0n),
      paymasterPostOpGasLimit: toHex(0n),
      paymasterData: '0x' as Hex,
      signature: '0x' as Hex, // Will be filled by sponsorship or left empty for EIP-7702
    };

    // Estimate gas limits
    const estimated = await this.estimateUserOperationGas(userOp, pimlicoUrl);
    userOp.callGasLimit = estimated.callGasLimit;
    userOp.verificationGasLimit = estimated.verificationGasLimit;
    userOp.preVerificationGas = estimated.preVerificationGas;

    return userOp;
  }

  /**
   * Sponsor UserOperation via Pimlico Paymaster
   */
  private async sponsorUserOperation(userOp: UserOperationV07, pimlicoUrl: string): Promise<UserOperationV07> {
    const response = await this.jsonRpc(pimlicoUrl, 'pm_sponsorUserOperation', [userOp, ENTRY_POINT_V07]);

    return {
      ...userOp,
      paymaster: response.paymaster,
      paymasterVerificationGasLimit: response.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: response.paymasterPostOpGasLimit,
      paymasterData: response.paymasterData,
      callGasLimit: response.callGasLimit ?? userOp.callGasLimit,
      verificationGasLimit: response.verificationGasLimit ?? userOp.verificationGasLimit,
      preVerificationGas: response.preVerificationGas ?? userOp.preVerificationGas,
    };
  }

  /**
   * Submit UserOperation to Pimlico Bundler
   */
  private async sendUserOperation(userOp: UserOperationV07, pimlicoUrl: string): Promise<string> {
    return this.jsonRpc(pimlicoUrl, 'eth_sendUserOperation', [userOp, ENTRY_POINT_V07]);
  }

  /**
   * Wait for UserOperation to be mined and get transaction hash
   */
  private async waitForUserOperation(userOpHash: string, pimlicoUrl: string): Promise<string> {
    const maxAttempts = 60;
    const delayMs = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const receipt = await this.jsonRpc(pimlicoUrl, 'eth_getUserOperationReceipt', [userOpHash]);

        if (receipt && receipt.receipt && receipt.receipt.transactionHash) {
          return receipt.receipt.transactionHash;
        }
      } catch {
        // Not mined yet, continue polling
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`UserOperation ${userOpHash} not mined after ${(maxAttempts * delayMs) / 1000}s`);
  }

  /**
   * Get gas prices from Pimlico
   */
  private async getGasPrice(pimlicoUrl: string): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const response = await this.jsonRpc(pimlicoUrl, 'pimlico_getUserOperationGasPrice', []);
    return {
      maxFeePerGas: BigInt(response.fast.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(response.fast.maxPriorityFeePerGas),
    };
  }

  /**
   * Get sender nonce from EntryPoint
   */
  private async getSenderNonce(sender: Address, pimlicoUrl: string): Promise<bigint> {
    // For EIP-7702, we use a special key that includes the authorization
    // The nonce format is: key (192 bits) | sequence (64 bits)
    // For simplicity, we use key = 0
    const key = 0n;

    try {
      const response = await this.jsonRpc(pimlicoUrl, 'eth_call', [
        {
          to: ENTRY_POINT_V07,
          data: encodeFunctionData({
            abi: parseAbi(['function getNonce(address sender, uint192 key) view returns (uint256)']),
            functionName: 'getNonce',
            args: [sender, key],
          }),
        },
        'latest',
      ]);
      return BigInt(response);
    } catch {
      return 0n;
    }
  }

  /**
   * Estimate gas for UserOperation
   */
  private async estimateUserOperationGas(
    userOp: UserOperationV07,
    pimlicoUrl: string,
  ): Promise<{ callGasLimit: Hex; verificationGasLimit: Hex; preVerificationGas: Hex }> {
    try {
      const response = await this.jsonRpc(pimlicoUrl, 'eth_estimateUserOperationGas', [userOp, ENTRY_POINT_V07]);
      return {
        callGasLimit: response.callGasLimit,
        verificationGasLimit: response.verificationGasLimit,
        preVerificationGas: response.preVerificationGas,
      };
    } catch {
      // Return defaults if estimation fails
      return {
        callGasLimit: toHex(200000n),
        verificationGasLimit: toHex(500000n),
        preVerificationGas: toHex(100000n),
      };
    }
  }

  /**
   * Make JSON-RPC call to Pimlico
   */
  private async jsonRpc(url: string, method: string, params: unknown[]): Promise<any> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now(),
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`${method} failed: ${data.error.message || JSON.stringify(data.error)}`);
    }

    return data.result;
  }

  /**
   * Get Pimlico bundler URL
   */
  private getPimlicoUrl(blockchain: Blockchain): string {
    const chainConfig = EVM_CHAIN_CONFIG[blockchain];
    if (!chainConfig) throw new Error(`No chain config for ${blockchain}`);
    return `https://api.pimlico.io/v2/${chainConfig.pimlicoName}/rpc?apikey=${this.apiKey}`;
  }
}
