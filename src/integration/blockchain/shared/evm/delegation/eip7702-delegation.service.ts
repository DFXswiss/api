import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import {
  Address,
  Chain,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  Hex,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount, signTypedData } from 'viem/accounts';
import { arbitrum, base, bsc, gnosis, mainnet, optimism, polygon, sepolia } from 'viem/chains';
import { WalletAccount } from '../domain/wallet-account';
import { EvmUtil } from '../evm.util';
import DELEGATION_MANAGER_ABI from './delegation-manager.abi.json';

// Contract addresses (same on all EVM chains via CREATE2)
const DELEGATOR_ADDRESS = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b' as Address;
const DELEGATION_MANAGER_ADDRESS = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as Address;

// ROOT_AUTHORITY constant - delegating own authority
const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex;

// ERC-7579 execution mode for single call
const CALLTYPE_SINGLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

// ERC20 transfer function
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

// Unified chain configuration: viem chain + config keys
const CHAIN_CONFIG: Partial<Record<Blockchain, { chain: Chain; configKey: string; prefix: string }>> = {
  [Blockchain.ETHEREUM]: { chain: mainnet, configKey: 'ethereum', prefix: 'eth' },
  [Blockchain.ARBITRUM]: { chain: arbitrum, configKey: 'arbitrum', prefix: 'arbitrum' },
  [Blockchain.OPTIMISM]: { chain: optimism, configKey: 'optimism', prefix: 'optimism' },
  [Blockchain.POLYGON]: { chain: polygon, configKey: 'polygon', prefix: 'polygon' },
  [Blockchain.BASE]: { chain: base, configKey: 'base', prefix: 'base' },
  [Blockchain.BINANCE_SMART_CHAIN]: { chain: bsc, configKey: 'bsc', prefix: 'bsc' },
  [Blockchain.GNOSIS]: { chain: gnosis, configKey: 'gnosis', prefix: 'gnosis' },
  [Blockchain.SEPOLIA]: { chain: sepolia, configKey: 'sepolia', prefix: 'sepolia' },
};

// Delegation struct type
interface Caveat {
  enforcer: Address;
  terms: Hex;
}

interface Delegation {
  delegate: Address;
  delegator: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
}

@Injectable()
export class Eip7702DelegationService {
  private readonly logger = new DfxLogger(Eip7702DelegationService);
  private readonly config = GetConfig().blockchain;

  /**
   * Check if delegation is enabled and supported for the given blockchain
   *
   * DISABLED: EIP-7702 gasless transactions require Pimlico integration.
   * The manual signing approach (eth_sign + eth_signTypedData_v4) doesn't work
   * because eth_sign is disabled by default in MetaMask.
   * TODO: Re-enable once Pimlico integration is complete.
   */
  isDelegationSupported(_blockchain: Blockchain): boolean {
    // Original: return this.config.evm.delegationEnabled && CHAIN_CONFIG[blockchain] !== undefined;
    return false;
  }

  /**
   * Check if delegation is supported for RealUnit (bypasses global disable)
   * RealUnit app supports eth_sign (unlike MetaMask), so EIP-7702 works
   */
  isDelegationSupportedForRealUnit(blockchain: Blockchain): boolean {
    return blockchain === Blockchain.ETHEREUM && CHAIN_CONFIG[blockchain] !== undefined;
  }

  /**
   * Check if user has zero native token balance
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
      // If balance check fails (RPC error, network issue, etc.), assume user has gas
      // This prevents transaction creation from failing completely
      this.logger.warn(
        `Failed to check native balance for ${userAddress} on ${blockchain}: ${error.message}. ` +
          `Assuming user has gas (not using EIP-7702).`,
      );
      return false;
    }
  }

  /**
   * Prepare delegation data for frontend signing
   * Returns EIP-712 data structure that frontend needs to sign
   */
  async prepareDelegationData(
    userAddress: string,
    blockchain: Blockchain,
  ): Promise<{
    relayerAddress: string;
    delegationManagerAddress: string;
    delegatorAddress: string;
    userNonce: number;
    domain: any;
    types: any;
    message: any;
  }> {
    if (!this.isDelegationSupported(blockchain)) {
      throw new Error(`EIP-7702 delegation not supported for ${blockchain}`);
    }
    return this._prepareDelegationDataInternal(userAddress, blockchain);
  }

  /**
   * Prepare delegation data for RealUnit (bypasses global disable)
   * RealUnit app supports eth_sign, so EIP-7702 works unlike MetaMask
   */
  async prepareDelegationDataForRealUnit(
    userAddress: string,
    blockchain: Blockchain,
  ): Promise<{
    relayerAddress: string;
    delegationManagerAddress: string;
    delegatorAddress: string;
    userNonce: number;
    domain: any;
    types: any;
    message: any;
  }> {
    if (!this.isDelegationSupportedForRealUnit(blockchain)) {
      throw new Error(`EIP-7702 delegation not supported for RealUnit on ${blockchain}`);
    }
    return this._prepareDelegationDataInternal(userAddress, blockchain);
  }

  /**
   * Internal implementation for preparing delegation data
   */
  private async _prepareDelegationDataInternal(
    userAddress: string,
    blockchain: Blockchain,
  ): Promise<{
    relayerAddress: string;
    delegationManagerAddress: string;
    delegatorAddress: string;
    userNonce: number;
    domain: any;
    types: any;
    message: any;
  }> {
    const chainConfig = CHAIN_CONFIG[blockchain];
    if (!chainConfig) throw new Error(`No chain config found for ${blockchain}`);

    // Fetch user's current account nonce for EIP-7702 authorization
    const fullChainConfig = this.getChainConfig(blockchain);
    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(fullChainConfig.rpcUrl),
    });

    const userNonce = Number(await publicClient.getTransactionCount({ address: userAddress as Address }));

    const relayerPrivateKey = this.getRelayerPrivateKey(blockchain);
    const relayerAccount = privateKeyToAccount(relayerPrivateKey);
    const salt = BigInt(Date.now());

    // EIP-712 domain
    const domain = {
      name: 'DelegationManager',
      version: '1',
      chainId: chainConfig.chain.id,
      verifyingContract: DELEGATION_MANAGER_ADDRESS,
    };

    // EIP-712 types
    const types = {
      Delegation: [
        { name: 'delegate', type: 'address' },
        { name: 'delegator', type: 'address' },
        { name: 'authority', type: 'bytes32' },
        { name: 'caveats', type: 'Caveat[]' },
        { name: 'salt', type: 'uint256' },
      ],
      Caveat: [
        { name: 'enforcer', type: 'address' },
        { name: 'terms', type: 'bytes' },
      ],
    };

    // Delegation message
    const message = {
      delegate: relayerAccount.address,
      delegator: userAddress,
      authority: ROOT_AUTHORITY,
      caveats: [],
      salt: Number(salt), // Convert BigInt to Number for JSON + EIP-712 compatibility
    };

    return {
      relayerAddress: relayerAccount.address,
      delegationManagerAddress: DELEGATION_MANAGER_ADDRESS,
      delegatorAddress: DELEGATOR_ADDRESS,
      userNonce,
      domain,
      types,
      message,
    };
  }

  /**
   * Execute token transfer using frontend-signed EIP-7702 delegation
   * Used for sell transactions where user has 0 native token
   */
  async transferTokenWithUserDelegation(
    userAddress: string,
    token: Asset,
    recipient: string,
    amount: number,
    signedDelegation: {
      delegate: string;
      delegator: string;
      authority: string;
      salt: string;
      signature: string;
    },
    authorization: any,
  ): Promise<string> {
    if (!this.isDelegationSupported(token.blockchain)) {
      throw new Error(`EIP-7702 delegation not supported for ${token.blockchain}`);
    }
    return this._transferTokenWithUserDelegationInternal(
      userAddress,
      token,
      recipient,
      amount,
      signedDelegation,
      authorization,
    );
  }

  /**
   * Execute token transfer for RealUnit (bypasses global disable)
   * RealUnit app supports eth_sign, so EIP-7702 works unlike MetaMask
   */
  async transferTokenWithUserDelegationForRealUnit(
    userAddress: string,
    token: Asset,
    recipient: string,
    amount: number,
    signedDelegation: {
      delegate: string;
      delegator: string;
      authority: string;
      salt: string;
      signature: string;
    },
    authorization: any,
  ): Promise<string> {
    if (!this.isDelegationSupportedForRealUnit(token.blockchain)) {
      throw new Error(`EIP-7702 delegation not supported for RealUnit on ${token.blockchain}`);
    }
    return this._transferTokenWithUserDelegationInternal(
      userAddress,
      token,
      recipient,
      amount,
      signedDelegation,
      authorization,
    );
  }

  /**
   * Internal implementation for token transfer with user delegation
   */
  private async _transferTokenWithUserDelegationInternal(
    userAddress: string,
    token: Asset,
    recipient: string,
    amount: number,
    signedDelegation: {
      delegate: string;
      delegator: string;
      authority: string;
      salt: string;
      signature: string;
    },
    authorization: any,
  ): Promise<string> {
    const blockchain = token.blockchain;

    // Input validation
    if (!amount || amount <= 0) {
      throw new Error(`Invalid transfer amount: ${amount}`);
    }
    if (!recipient || !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }
    if (!token.chainId || !/^0x[a-fA-F0-9]{40}$/.test(token.chainId)) {
      throw new Error(`Invalid token contract address: ${token.chainId}`);
    }

    const chainConfig = this.getChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`No chain config found for ${blockchain}`);
    }

    // Get relayer account
    const relayerPrivateKey = this.getRelayerPrivateKey(blockchain);
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

    // 1. Rebuild delegation from signed data
    const delegation: Delegation = {
      delegate: signedDelegation.delegate as Address,
      delegator: signedDelegation.delegator as Address,
      authority: signedDelegation.authority as Hex,
      caveats: [],
      salt: BigInt(signedDelegation.salt),
      signature: signedDelegation.signature as Hex,
    };

    // 2. Encode ERC20 transfer call
    const amountWei = BigInt(EvmUtil.toWeiAmount(amount, token.decimals).toString());
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipient as Address, amountWei],
    });

    // 3. Encode execution data using ERC-7579 format
    const executionData = encodePacked(['address', 'uint256', 'bytes'], [token.chainId as Address, 0n, transferData]);

    // 4. Encode permission context
    const permissionContext = this.encodePermissionContext([delegation]);

    // 5. Encode redeemDelegations call
    const redeemData = encodeFunctionData({
      abi: DELEGATION_MANAGER_ABI,
      functionName: 'redeemDelegations',
      args: [[permissionContext], [CALLTYPE_SINGLE], [executionData]],
    });

    // Use EIP-1559 gas parameters with dynamic fee estimation
    const block = await publicClient.getBlock();
    const maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    const maxFeePerGas = block.baseFeePerGas
      ? block.baseFeePerGas * 2n + maxPriorityFeePerGas
      : maxPriorityFeePerGas * 2n;

    // Use fixed gas limit since estimateGas fails with low-balance relayer account
    // Typical EIP-7702 delegation transfer uses ~150k gas
    // TODO: Implement dynamic gas estimation once relayer has sufficient balance for simulation
    const gasLimit = 200000n;

    const estimatedGasCost = (maxFeePerGas * gasLimit) / BigInt(1e18);
    this.logger.verbose(
      `Executing user delegation transfer on ${blockchain}: ${amount} ${token.name} ` +
        `from ${userAddress} to ${recipient} (gasLimit: ${gasLimit}, estimatedCost: ~${estimatedGasCost} native)`,
    );

    // Get nonce and chain ID
    const nonce = await publicClient.getTransactionCount({ address: relayerAccount.address });
    const chainId = await publicClient.getChainId();

    // Convert authorization to Viem format
    const viemAuthorization = {
      chainId: BigInt(authorization.chainId),
      address: authorization.address as Address, // CRITICAL: Must be 'address', not 'contractAddress'
      nonce: BigInt(authorization.nonce),
      r: authorization.r as Hex,
      s: authorization.s as Hex,
      yParity: authorization.yParity,
    };

    // Manually construct complete transaction to bypass viem's gas validation
    const transaction = {
      from: relayerAccount.address as Address,
      to: DELEGATION_MANAGER_ADDRESS,
      data: redeemData,
      value: 0n, // No ETH transfer
      nonce,
      chainId,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      authorizationList: [viemAuthorization],
      type: 'eip7702' as const,
    };

    // Sign and broadcast transaction
    const signedTx = await walletClient.signTransaction(transaction as any);
    const txHash = await walletClient.sendRawTransaction({ serializedTransaction: signedTx as `0x${string}` });

    this.logger.info(
      `User delegation transfer successful on ${blockchain}: ` +
        `${amount} ${token.name} to ${recipient} | TX: ${txHash}`,
    );

    return txHash;
  }

  /**
   * Transfer tokens via EIP-7702 delegation using DelegationManager
   * Flow: Relayer -> DelegationManager.redeemDelegations() -> Account.executeFromExecutor()
   * Single transaction instead of gas-topup + token transfer
   * Used for payin (backend controls deposit account)
   */
  async transferTokenViaDelegation(
    depositAccount: WalletAccount,
    token: Asset,
    recipient: string,
    amount: number,
  ): Promise<string> {
    const blockchain = token.blockchain;

    // Input validation
    if (!amount || amount <= 0) {
      throw new Error(`Invalid transfer amount: ${amount}`);
    }
    if (!recipient || !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }
    if (!token.chainId || !/^0x[a-fA-F0-9]{40}$/.test(token.chainId)) {
      throw new Error(`Invalid token contract address: ${token.chainId}`);
    }

    if (!this.isDelegationSupported(blockchain)) {
      throw new Error(`EIP-7702 delegation not supported for ${blockchain}`);
    }

    const chainConfig = this.getChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`No chain config found for ${blockchain}`);
    }

    // Create deposit wallet from account
    const depositWallet = EvmUtil.createWallet(depositAccount);
    const depositAddress = depositWallet.address as Address;
    const depositPrivateKey = depositWallet.privateKey as Hex;

    // Create viem accounts
    const depositViemAccount = privateKeyToAccount(depositPrivateKey);
    const relayerPrivateKey = this.getRelayerPrivateKey(blockchain);
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

    // 1. Create and sign delegation (deposit -> relayer)
    const delegation = await this.createSignedDelegation(
      depositPrivateKey,
      relayerAccount.address,
      depositAddress,
      chainConfig.chain.id,
    );

    // 2. Encode ERC20 transfer call
    const amountWei = BigInt(EvmUtil.toWeiAmount(amount, token.decimals).toString());
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipient as Address, amountWei],
    });

    // 3. Encode execution data using ERC-7579 format: encodePacked(target, value, callData)
    // Format: address (20 bytes) + uint256 (32 bytes) + callData (variable)
    const executionData = encodePacked(['address', 'uint256', 'bytes'], [token.chainId as Address, 0n, transferData]);

    // 4. Encode permission context (array of delegations)
    const permissionContext = this.encodePermissionContext([delegation]);

    // 5. Encode redeemDelegations call
    const redeemData = encodeFunctionData({
      abi: DELEGATION_MANAGER_ABI,
      functionName: 'redeemDelegations',
      args: [[permissionContext], [CALLTYPE_SINGLE], [executionData]],
    });

    // 6. Sign EIP-7702 authorization (deposit address delegates to MetaMask delegator contract)
    const authorization = await walletClient.signAuthorization({
      account: depositViemAccount,
      contractAddress: DELEGATOR_ADDRESS,
    });

    // Estimate gas with 20% buffer (consistent with evm-client.ts pattern)
    const gasEstimate = await publicClient.estimateGas({
      account: relayerAccount,
      to: DELEGATION_MANAGER_ADDRESS,
      data: redeemData,
      authorizationList: [authorization],
    } as any);
    const gasLimit = (gasEstimate * 120n) / 100n;

    // Use EIP-1559 gas parameters (maxFeePerGas) instead of legacy gasPrice
    const block = await publicClient.getBlock();
    const maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    const maxFeePerGas = block.baseFeePerGas
      ? block.baseFeePerGas * 2n + maxPriorityFeePerGas
      : maxPriorityFeePerGas * 2n;

    const estimatedGasCost = (maxFeePerGas * gasLimit) / BigInt(1e18);
    this.logger.verbose(
      `Executing delegation transfer via DelegationManager on ${blockchain}: ${amount} ${token.name} ` +
        `from ${depositAddress} to ${recipient} (gasLimit: ${gasLimit}, estimatedCost: ~${estimatedGasCost} native)`,
    );

    // Send transaction to DelegationManager with authorization
    const txHash = await walletClient.sendTransaction({
      to: DELEGATION_MANAGER_ADDRESS,
      data: redeemData,
      authorizationList: [authorization],
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    } as any);

    this.logger.info(
      `Delegation transfer via DelegationManager successful on ${blockchain}: ` +
        `${amount} ${token.name} to ${recipient} | TX: ${txHash}`,
    );

    return txHash;
  }

  /**
   * Create and sign a delegation from deposit account to relayer
   */
  private async createSignedDelegation(
    depositPrivateKey: Hex,
    relayerAddress: Address,
    depositAddress: Address,
    chainId: number,
  ): Promise<Delegation> {
    // Create delegation struct
    const delegation: Delegation = {
      delegate: relayerAddress,
      delegator: depositAddress,
      authority: ROOT_AUTHORITY,
      caveats: [], // No restrictions
      salt: BigInt(Date.now()), // Unique salt
      signature: '0x' as Hex,
    };

    // EIP-712 typed data for delegation signing
    const domain = {
      name: 'DelegationManager',
      version: '1',
      chainId: chainId,
      verifyingContract: DELEGATION_MANAGER_ADDRESS,
    };

    const types = {
      Delegation: [
        { name: 'delegate', type: 'address' },
        { name: 'delegator', type: 'address' },
        { name: 'authority', type: 'bytes32' },
        { name: 'caveats', type: 'Caveat[]' },
        { name: 'salt', type: 'uint256' },
      ],
      Caveat: [
        { name: 'enforcer', type: 'address' },
        { name: 'terms', type: 'bytes' },
      ],
    };

    const message = {
      delegate: delegation.delegate,
      delegator: delegation.delegator,
      authority: delegation.authority,
      caveats: delegation.caveats,
      salt: delegation.salt,
    };

    // Sign the delegation
    const signature = await signTypedData({
      privateKey: depositPrivateKey,
      domain,
      types,
      primaryType: 'Delegation',
      message,
    });

    delegation.signature = signature;

    return delegation;
  }

  /**
   * Encode permission context (array of delegations) for redeemDelegations
   */
  private encodePermissionContext(delegations: Delegation[]): Hex {
    // Each delegation is encoded as a tuple
    const encodedDelegations = delegations.map((d) => ({
      delegate: d.delegate,
      delegator: d.delegator,
      authority: d.authority,
      caveats: d.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: d.salt,
      signature: d.signature,
    }));

    // Encode as array of Delegation tuples
    return encodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            { name: 'delegate', type: 'address' },
            { name: 'delegator', type: 'address' },
            { name: 'authority', type: 'bytes32' },
            {
              name: 'caveats',
              type: 'tuple[]',
              components: [
                { name: 'enforcer', type: 'address' },
                { name: 'terms', type: 'bytes' },
              ],
            },
            { name: 'salt', type: 'uint256' },
            { name: 'signature', type: 'bytes' },
          ],
        },
      ],
      [encodedDelegations],
    );
  }

  /**
   * Get chain configuration for viem
   */
  private getChainConfig(blockchain: Blockchain): { chain: Chain; rpcUrl: string } | undefined {
    const config = CHAIN_CONFIG[blockchain];
    if (!config) return undefined;

    const chainConfig = this.config[config.configKey];
    const rpcUrl = `${chainConfig[`${config.prefix}GatewayUrl`]}/${chainConfig[`${config.prefix}ApiKey`] ?? ''}`;

    return { chain: config.chain, rpcUrl };
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
