import { Injectable } from '@nestjs/common';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  concat,
  toHex,
  pad,
  Hex,
  Address,
  Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, optimism, polygon, base, bsc, gnosis, sepolia } from 'viem/chains';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { WalletAccount } from '../domain/wallet-account';
import { EvmUtil } from '../evm.util';
import EIP7702_DELEGATOR_ABI from './eip7702-stateless-delegator.abi.json';

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

@Injectable()
export class Eip7702DelegationService {
  private readonly logger = new DfxLogger(Eip7702DelegationService);
  private readonly delegatorAddress: Address;
  private readonly config = GetConfig().blockchain;

  constructor() {
    this.delegatorAddress = this.config.evm.delegatorAddress as Address;
  }

  /**
   * Check if delegation is enabled and supported for the given blockchain
   */
  isDelegationSupported(blockchain: Blockchain): boolean {
    return this.config.evm.delegationEnabled && CHAIN_CONFIG[blockchain] !== undefined;
  }

  /**
   * Transfer tokens via EIP-7702 delegation
   * Single transaction instead of gas-topup + token transfer
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

    // Encode ERC20 transfer call
    const amountWei = BigInt(EvmUtil.toWeiAmount(amount, token.decimals).toString());
    const transferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipient as Address, amountWei],
    });

    // Encode execution data for EIP7702StatelessDeleGator
    // Format: target (20 bytes) || value (32 bytes) || callData
    const executionData = concat([
      token.chainId as Address, // target (ERC20 token contract)
      pad(toHex(0n), { size: 32 }), // value (0 for token transfer)
      transferData, // callData
    ]);

    // Encode the execute call on the delegator
    const executeData = encodeFunctionData({
      abi: EIP7702_DELEGATOR_ABI,
      functionName: 'execute',
      args: [CALLTYPE_SINGLE, executionData],
    });

    // Sign EIP-7702 authorization (deposit address delegates to delegator contract)
    const authorization = await walletClient.signAuthorization({
      account: depositViemAccount,
      contractAddress: this.delegatorAddress,
    });

    // Get gas price with buffer
    const gasPrice = await publicClient.getGasPrice();
    const gasPriceWithBuffer = (gasPrice * 120n) / 100n; // 20% buffer

    // Estimate gas for the transaction
    // Note: Gas estimation without authorizationList may underestimate because
    // the deposit address is still an EOA at estimation time. Using 30% buffer to compensate.
    const gasEstimate = await publicClient.estimateGas({
      account: relayerAccount,
      to: depositAddress,
      data: executeData,
    });
    const gasLimit = (gasEstimate * 130n) / 100n; // 30% buffer for EIP-7702 overhead

    const estimatedGasCost = (gasPriceWithBuffer * gasLimit) / BigInt(1e18);
    this.logger.verbose(
      `Executing delegation transfer on ${blockchain}: ${amount} ${token.name} from ${depositAddress} to ${recipient} ` +
        `(gasLimit: ${gasLimit}, gasPrice: ${gasPriceWithBuffer}, estimatedCost: ~${estimatedGasCost} ETH)`,
    );

    // Send transaction with authorization
    // Note: Using 'as any' because viem's TypeScript types don't yet fully support EIP-7702 authorizationList
    const txHash = await walletClient.sendTransaction({
      to: depositAddress, // Call to the deposit address (with delegated code)
      data: executeData,
      authorizationList: [authorization],
      gas: gasLimit,
      gasPrice: gasPriceWithBuffer,
    } as any);

    this.logger.info(
      `Delegation transfer successful on ${blockchain}: ${amount} ${token.name} to ${recipient} | TX: ${txHash}`,
    );

    return txHash;
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
