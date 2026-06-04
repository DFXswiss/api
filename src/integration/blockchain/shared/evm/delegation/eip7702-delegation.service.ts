import { Injectable } from '@nestjs/common';
import { Config, Environment, GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import {
  Address,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  Hex,
  http,
  parseAbi,
  recoverTypedDataAddress,
} from 'viem';
import { privateKeyToAccount, signTypedData } from 'viem/accounts';
import { recoverAuthorizationAddress } from 'viem/utils';
import { WalletAccount } from '../domain/wallet-account';
import { EvmUtil } from '../evm.util';
import DELEGATION_MANAGER_ABI from './delegation-manager.abi.json';

interface Eip7702Authorization {
  chainId: string | number;
  address: string;
  nonce: string | number;
  r: string;
  s: string;
  yParity: number;
}

// Contract addresses (same on all EVM chains via CREATE2)
const DELEGATOR_ADDRESS = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b' as Address;
const DELEGATION_MANAGER_ADDRESS = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as Address;

// ROOT_AUTHORITY constant - delegating own authority
const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as Hex;

// ERC-7579 execution mode for single call
const CALLTYPE_SINGLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

// EIP-712 types for DelegationManager (shared between prepare, sign and verify)
const DELEGATION_EIP712_TYPES = {
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
} as const;

function getDelegationEip712Domain(chainId: number) {
  return {
    name: 'DelegationManager',
    version: '1',
    chainId,
    verifyingContract: DELEGATION_MANAGER_ADDRESS,
  };
}

// ERC20 transfer function
const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

// ERC677 transferAndCall function (used by REALU token for BrokerBot interaction)
const ERC677_ABI = parseAbi(['function transferAndCall(address to, uint256 value, bytes data) returns (bool)']);

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

  // Sequential lock for relayer nonce management (prevents concurrent nonce collisions)
  private nonceLock: Promise<void> = Promise.resolve();

  private async withNonceLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousLock = this.nonceLock;
    this.nonceLock = lock;
    await previousLock;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

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
    const expectedBlockchain = [Environment.DEV, Environment.LOC].includes(Config.environment)
      ? Blockchain.SEPOLIA
      : Blockchain.ETHEREUM;
    return blockchain === expectedBlockchain && EvmUtil.hasViemChainConfig(blockchain);
  }

  /**
   * Check if user has zero native token balance
   */
  async hasZeroNativeBalance(userAddress: string, blockchain: Blockchain): Promise<boolean> {
    const chainConfig = EvmUtil.getViemChainConfig(blockchain);
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
   *
   * `delegateAddressOverride` (optional) sets the delegation's `delegate` to a caller-supplied
   * address instead of the per-chain Sell/OTC relayer. The MetaMask DelegationManager enforces
   * `msg.sender === delegation.delegate` in `redeemDelegations`, so the delegate MUST equal the
   * address that relays (pays gas) at confirm time. The RealUnit W2W transfer relays from the
   * dedicated W2W gas wallet, so it passes that wallet's address here to keep delegate == redeemer.
   */
  async prepareDelegationDataForRealUnit(
    userAddress: string,
    blockchain: Blockchain,
    delegateAddressOverride?: string,
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
    return this._prepareDelegationDataInternal(userAddress, blockchain, delegateAddressOverride);
  }

  /**
   * Internal implementation for preparing delegation data
   */
  private async _prepareDelegationDataInternal(
    userAddress: string,
    blockchain: Blockchain,
    delegateAddressOverride?: string,
  ): Promise<{
    relayerAddress: string;
    delegationManagerAddress: string;
    delegatorAddress: string;
    userNonce: number;
    domain: any;
    types: any;
    message: any;
  }> {
    const chainConfig = EvmUtil.getViemChainConfig(blockchain);
    if (!chainConfig) throw new Error(`No chain config found for ${blockchain}`);

    // Fetch user's current account nonce for EIP-7702 authorization
    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });

    const userNonce = Number(await publicClient.getTransactionCount({ address: userAddress as Address }));

    // The delegate must equal the address that relays redeemDelegations (msg.sender). Default is the
    // per-chain Sell/OTC relayer (which also redeems for sell/OTC); the W2W transfer overrides it with
    // the dedicated W2W gas wallet address so the contract's `msg.sender == delegate` check passes.
    const relayerPrivateKey = this.getRelayerPrivateKey(blockchain);
    const relayerAddress = (delegateAddressOverride ?? privateKeyToAccount(relayerPrivateKey).address) as Address;
    const salt = BigInt(Date.now());

    const domain = getDelegationEip712Domain(chainConfig.chain.id);
    const types = DELEGATION_EIP712_TYPES;

    // Delegation message
    const message = {
      delegate: relayerAddress,
      delegator: userAddress,
      authority: ROOT_AUTHORITY,
      caveats: [],
      salt: Number(salt), // Convert BigInt to Number for JSON + EIP-712 compatibility
    };

    return {
      relayerAddress,
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
   *
   * `relayerPrivateKeyOverride` (optional) pays gas from a caller-supplied wallet instead of the
   * per-chain Sell/OTC relayer. Defaults to `getRelayerPrivateKey(blockchain)`, so existing callers
   * are unchanged. Used by the RealUnit W2W transfer to pay gas from the dedicated W2W gas wallet.
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
    authorization: Eip7702Authorization,
    relayerPrivateKeyOverride?: Hex,
  ): Promise<string> {
    if (!this.isDelegationSupported(token.blockchain) && !this.isDelegationSupportedForRealUnit(token.blockchain)) {
      throw new Error(`EIP-7702 delegation not supported for ${token.blockchain}`);
    }
    return this._transferTokenWithUserDelegationInternal(
      userAddress,
      token,
      recipient,
      amount,
      signedDelegation,
      authorization,
      relayerPrivateKeyOverride,
    );
  }

  /**
   * Execute BrokerBot sell for RealUnit via EIP-7702 delegation
   * Atomic batch: REALU -> BrokerBot (via transferAndCall) + ZCHF -> DFX Deposit (via transfer)
   */
  async executeBrokerBotSellForRealUnit(
    userAddress: string,
    realuToken: Asset,
    zchfTokenAddress: string,
    brokerbotAddress: string,
    dfxDepositAddress: string,
    realuAmount: number,
    zchfAmountWei: bigint,
    signedDelegation: {
      delegate: string;
      delegator: string;
      authority: string;
      salt: string;
      signature: string;
    },
    authorization: Eip7702Authorization,
  ): Promise<string> {
    if (!this.isDelegationSupportedForRealUnit(realuToken.blockchain)) {
      throw new Error(`EIP-7702 delegation not supported for RealUnit on ${realuToken.blockchain}`);
    }
    return this._executeBrokerBotSellInternal(
      userAddress,
      realuToken,
      zchfTokenAddress,
      brokerbotAddress,
      dfxDepositAddress,
      realuAmount,
      zchfAmountWei,
      signedDelegation,
      authorization,
    );
  }

  /**
   * Internal implementation for BrokerBot sell with atomic batch delegation
   */
  private async _executeBrokerBotSellInternal(
    userAddress: string,
    realuToken: Asset,
    zchfTokenAddress: string,
    brokerbotAddress: string,
    dfxDepositAddress: string,
    realuAmount: number,
    zchfAmountWei: bigint,
    signedDelegation: {
      delegate: string;
      delegator: string;
      authority: string;
      salt: string;
      signature: string;
    },
    authorization: Eip7702Authorization,
  ): Promise<string> {
    const blockchain = realuToken.blockchain;

    // Input validation
    if (!realuAmount || realuAmount <= 0) {
      throw new Error(`Invalid REALU amount: ${realuAmount}`);
    }
    if (!dfxDepositAddress || !/^0x[a-fA-F0-9]{40}$/.test(dfxDepositAddress)) {
      throw new Error(`Invalid DFX deposit address: ${dfxDepositAddress}`);
    }
    if (!realuToken.chainId || !/^0x[a-fA-F0-9]{40}$/.test(realuToken.chainId)) {
      throw new Error(`Invalid REALU token contract address: ${realuToken.chainId}`);
    }
    if (!brokerbotAddress || !/^0x[a-fA-F0-9]{40}$/.test(brokerbotAddress)) {
      throw new Error(`Invalid BrokerBot address: ${brokerbotAddress}`);
    }
    if (!zchfTokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(zchfTokenAddress)) {
      throw new Error(`Invalid ZCHF token address: ${zchfTokenAddress}`);
    }

    const chainConfig = EvmUtil.getViemChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`No chain config found for ${blockchain}`);
    }

    const expectedChainId = chainConfig.chain.id;

    // Validate authorization fields
    if (Number(authorization.chainId) !== expectedChainId) {
      throw new Error(`Authorization chainId mismatch: expected ${expectedChainId}, got ${authorization.chainId}`);
    }
    if (authorization.address.toLowerCase() !== DELEGATOR_ADDRESS.toLowerCase()) {
      throw new Error(
        `Authorization contract address mismatch: expected ${DELEGATOR_ADDRESS}, got ${authorization.address}`,
      );
    }

    // Verify EIP-712 delegation signature
    await this.verifyDelegationSignature(signedDelegation, expectedChainId, userAddress);

    // Verify EIP-7702 authorization signature
    await this.verifyAuthorizationSignature(authorization, userAddress);

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

    // 2. Encode Call 1: REALU -> BrokerBot via ERC-677 transferAndCall
    const realuAmountWei = BigInt(EvmUtil.toWeiAmount(realuAmount, realuToken.decimals).toString());
    const transferAndCallData = encodeFunctionData({
      abi: ERC677_ABI,
      functionName: 'transferAndCall',
      args: [brokerbotAddress as Address, realuAmountWei, '0x' as Hex],
    });
    const executionData1 = encodePacked(
      ['address', 'uint256', 'bytes'],
      [realuToken.chainId as Address, 0n, transferAndCallData],
    );

    // 3. Encode Call 2: ZCHF -> DFX Deposit via ERC-20 transfer
    const zchfTransferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [dfxDepositAddress as Address, zchfAmountWei],
    });
    const executionData2 = encodePacked(
      ['address', 'uint256', 'bytes'],
      [zchfTokenAddress as Address, 0n, zchfTransferData],
    );

    // 4. Encode permission context (same delegation for both calls)
    const permissionContext = this.encodePermissionContext([delegation]);

    // 5. Encode redeemDelegations call with batch (2 calls)
    const redeemData = encodeFunctionData({
      abi: DELEGATION_MANAGER_ABI,
      functionName: 'redeemDelegations',
      args: [
        [permissionContext, permissionContext],
        [CALLTYPE_SINGLE, CALLTYPE_SINGLE],
        [executionData1, executionData2],
      ],
    });

    // Use EIP-1559 gas parameters with dynamic fee estimation
    const block = await publicClient.getBlock();
    const maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
    const maxFeePerGas = block.baseFeePerGas
      ? block.baseFeePerGas * 2n + maxPriorityFeePerGas
      : maxPriorityFeePerGas * 2n;

    // Higher gas limit for BrokerBot interaction + 2 token transfers
    const gasLimit = 500000n;

    const estimatedGasCost = (maxFeePerGas * gasLimit) / BigInt(1e18);
    this.logger.verbose(
      `Executing BrokerBot sell on ${blockchain}: ${realuAmount} REALU ` +
        `from ${userAddress} via BrokerBot ${brokerbotAddress} -> ZCHF to ${dfxDepositAddress} ` +
        `(gasLimit: ${gasLimit}, estimatedCost: ~${estimatedGasCost} native)`,
    );

    // Convert authorization to Viem format
    const viemAuthorization = {
      chainId: BigInt(authorization.chainId),
      address: authorization.address as Address,
      nonce: BigInt(authorization.nonce),
      r: authorization.r as Hex,
      s: authorization.s as Hex,
      yParity: authorization.yParity,
    };

    // Sign, broadcast and confirm within nonce lock to prevent concurrent nonce collisions
    return this.withNonceLock(async () => {
      const nonce = await publicClient.getTransactionCount({
        address: relayerAccount.address,
        blockTag: 'pending',
      });
      const chainId = await publicClient.getChainId();

      const transaction = {
        from: relayerAccount.address as Address,
        to: DELEGATION_MANAGER_ADDRESS,
        data: redeemData,
        value: 0n,
        nonce,
        chainId,
        gas: gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        authorizationList: [viemAuthorization],
        type: 'eip7702' as const,
      };

      const signedTx = await walletClient.signTransaction(transaction as any);
      const txHash = await walletClient.sendRawTransaction({ serializedTransaction: signedTx as `0x${string}` });

      this.logger.info(
        `BrokerBot sell broadcast on ${blockchain}: ` +
          `${realuAmount} REALU -> ZCHF to ${dfxDepositAddress} | TX: ${txHash}`,
      );

      // Wait for on-chain confirmation before returning
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted on-chain: ${txHash}`);
      }

      this.logger.info(`BrokerBot sell confirmed on ${blockchain}: TX ${txHash} (block ${receipt.blockNumber})`);

      return txHash;
    });
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
    authorization: Eip7702Authorization,
    relayerPrivateKeyOverride?: Hex,
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

    const chainConfig = EvmUtil.getViemChainConfig(blockchain);
    if (!chainConfig) {
      throw new Error(`No chain config found for ${blockchain}`);
    }

    const expectedChainId = chainConfig.chain.id;

    // Validate authorization fields
    if (Number(authorization.chainId) !== expectedChainId) {
      throw new Error(`Authorization chainId mismatch: expected ${expectedChainId}, got ${authorization.chainId}`);
    }
    if (authorization.address.toLowerCase() !== DELEGATOR_ADDRESS.toLowerCase()) {
      throw new Error(
        `Authorization contract address mismatch: expected ${DELEGATOR_ADDRESS}, got ${authorization.address}`,
      );
    }

    // Verify EIP-712 delegation signature
    await this.verifyDelegationSignature(signedDelegation, expectedChainId, userAddress);

    // Verify EIP-7702 authorization signature
    await this.verifyAuthorizationSignature(authorization, userAddress);

    // Get relayer account (default: per-chain Sell/OTC relayer; override: dedicated gas wallet)
    const relayerPrivateKey = relayerPrivateKeyOverride ?? this.getRelayerPrivateKey(blockchain);
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

    // Convert authorization to Viem format
    const viemAuthorization = {
      chainId: BigInt(authorization.chainId),
      address: authorization.address as Address,
      nonce: BigInt(authorization.nonce),
      r: authorization.r as Hex,
      s: authorization.s as Hex,
      yParity: authorization.yParity,
    };

    // Sign, broadcast and confirm within nonce lock to prevent concurrent nonce collisions
    return this.withNonceLock(async () => {
      const nonce = await publicClient.getTransactionCount({
        address: relayerAccount.address,
        blockTag: 'pending',
      });
      const chainId = await publicClient.getChainId();

      const transaction = {
        from: relayerAccount.address as Address,
        to: DELEGATION_MANAGER_ADDRESS,
        data: redeemData,
        value: 0n,
        nonce,
        chainId,
        gas: gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
        authorizationList: [viemAuthorization],
        type: 'eip7702' as const,
      };

      const signedTx = await walletClient.signTransaction(transaction as any);
      const txHash = await walletClient.sendRawTransaction({ serializedTransaction: signedTx as `0x${string}` });

      this.logger.info(
        `User delegation transfer broadcast on ${blockchain}: ` +
          `${amount} ${token.name} to ${recipient} | TX: ${txHash}`,
      );

      // Wait for on-chain confirmation before returning
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

      if (receipt.status === 'reverted') {
        throw new Error(`Transaction reverted on-chain: ${txHash}`);
      }

      this.logger.info(
        `User delegation transfer confirmed on ${blockchain}: TX ${txHash} (block ${receipt.blockNumber})`,
      );

      return txHash;
    });
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

    const chainConfig = EvmUtil.getViemChainConfig(blockchain);
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

    const domain = getDelegationEip712Domain(chainId);
    const types = DELEGATION_EIP712_TYPES;

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
   * Verify EIP-712 delegation signature was signed by the expected user
   */
  private async verifyDelegationSignature(
    signedDelegation: { delegate: string; delegator: string; authority: string; salt: string; signature: string },
    chainId: number,
    expectedSigner: string,
  ): Promise<void> {
    const recoveredAddress = await recoverTypedDataAddress({
      domain: getDelegationEip712Domain(chainId),
      types: DELEGATION_EIP712_TYPES,
      primaryType: 'Delegation',
      message: {
        delegate: signedDelegation.delegate as Address,
        delegator: signedDelegation.delegator as Address,
        authority: signedDelegation.authority as Hex,
        caveats: [],
        salt: BigInt(signedDelegation.salt),
      },
      signature: signedDelegation.signature as Hex,
    });

    if (recoveredAddress.toLowerCase() !== expectedSigner.toLowerCase()) {
      throw new Error(`Invalid delegation signature: recovered ${recoveredAddress}, expected ${expectedSigner}`);
    }
  }

  /**
   * Verify EIP-7702 authorization signature was signed by the expected user
   */
  private async verifyAuthorizationSignature(
    authorization: Eip7702Authorization,
    expectedSigner: string,
  ): Promise<void> {
    const recoveredAddress = await recoverAuthorizationAddress({
      authorization: {
        chainId: Number(authorization.chainId),
        address: authorization.address as Address,
        nonce: Number(authorization.nonce),
        r: authorization.r as Hex,
        s: authorization.s as Hex,
        yParity: authorization.yParity,
      },
    });

    if (recoveredAddress.toLowerCase() !== expectedSigner.toLowerCase()) {
      throw new Error(`Invalid authorization signature: recovered ${recoveredAddress}, expected ${expectedSigner}`);
    }
  }

  /**
   * Get relayer private key for the blockchain
   */
  private getRelayerPrivateKey(blockchain: Blockchain): Hex {
    const config = EvmUtil.getViemChainConfig(blockchain);
    if (!config) throw new Error(`No config found for ${blockchain}`);

    const key = this.config[config.configKey][`${config.prefix}WalletPrivateKey`];
    if (!key) throw new Error(`No relayer private key configured for ${blockchain}`);

    return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
  }
}
