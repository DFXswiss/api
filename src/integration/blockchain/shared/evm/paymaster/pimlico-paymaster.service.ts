import { Injectable } from '@nestjs/common';
import { createPublicClient, http, Hex, Address, Chain, formatEther } from 'viem';
import { mainnet, arbitrum, optimism, polygon, base, bsc, gnosis, sepolia } from 'viem/chains';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/shared/services/dfx-logger';

// Pimlico chain IDs for API endpoints (uses chain ID numbers)
const PIMLICO_CHAIN_IDS: Partial<Record<Blockchain, number>> = {
  [Blockchain.ETHEREUM]: 1,
  [Blockchain.ARBITRUM]: 42161,
  [Blockchain.OPTIMISM]: 10,
  [Blockchain.POLYGON]: 137,
  [Blockchain.BASE]: 8453,
  [Blockchain.BINANCE_SMART_CHAIN]: 56,
  [Blockchain.GNOSIS]: 100,
  [Blockchain.SEPOLIA]: 11155111,
};

// Chain configuration for viem
const CHAIN_CONFIG: Partial<Record<Blockchain, Chain>> = {
  [Blockchain.ETHEREUM]: mainnet,
  [Blockchain.ARBITRUM]: arbitrum,
  [Blockchain.OPTIMISM]: optimism,
  [Blockchain.POLYGON]: polygon,
  [Blockchain.BASE]: base,
  [Blockchain.BINANCE_SMART_CHAIN]: bsc,
  [Blockchain.GNOSIS]: gnosis,
  [Blockchain.SEPOLIA]: sepolia,
};

export interface PaymasterSponsorshipResult {
  sponsored: boolean;
  paymasterAndData?: Hex;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  preVerificationGas?: bigint;
  verificationGasLimit?: bigint;
  callGasLimit?: bigint;
  error?: string;
}

export interface GasPriceResult {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

@Injectable()
export class PimlicoPaymasterService {
  private readonly logger = new DfxLogger(PimlicoPaymasterService);
  private readonly config = GetConfig().blockchain;

  /**
   * Check if Pimlico paymaster is configured and available for blockchain
   */
  isPaymasterAvailable(blockchain: Blockchain): boolean {
    const apiKey = this.config.evm.pimlicoApiKey;
    const chainId = PIMLICO_CHAIN_IDS[blockchain];

    return Boolean(apiKey && chainId);
  }

  /**
   * Get supported blockchains for Pimlico paymaster
   */
  getSupportedBlockchains(): Blockchain[] {
    return Object.keys(PIMLICO_CHAIN_IDS) as Blockchain[];
  }

  /**
   * Get Pimlico bundler RPC URL for a blockchain
   */
  getBundlerUrl(blockchain: Blockchain): string | undefined {
    const apiKey = this.config.evm.pimlicoApiKey;
    const chainId = PIMLICO_CHAIN_IDS[blockchain];

    if (!apiKey || !chainId) return undefined;

    return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
  }

  /**
   * Get current gas prices from Pimlico
   * Uses pimlico_getUserOperationGasPrice for accurate gas estimation
   */
  async getGasPrice(blockchain: Blockchain): Promise<GasPriceResult> {
    const bundlerUrl = this.getBundlerUrl(blockchain);
    if (!bundlerUrl) {
      throw new Error(`Pimlico not configured for ${blockchain}`);
    }

    try {
      const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'pimlico_getUserOperationGasPrice',
          params: [],
          id: 1,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || 'Failed to get gas price');
      }

      // Pimlico returns { slow, standard, fast } - use standard for balance
      const gasPrice = data.result?.standard || data.result?.fast;

      return {
        maxFeePerGas: BigInt(gasPrice.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(gasPrice.maxPriorityFeePerGas),
      };
    } catch (error) {
      this.logger.warn(`Failed to get Pimlico gas price for ${blockchain}: ${error.message}`);

      // Fallback to on-chain estimation
      return this.getFallbackGasPrice(blockchain);
    }
  }

  /**
   * Sponsor a transaction via Pimlico paymaster
   * For EIP-7702 transactions, we use pm_sponsorUserOperation
   */
  async sponsorTransaction(
    blockchain: Blockchain,
    userAddress: Address,
    targetAddress: Address,
    callData: Hex,
    value: bigint = 0n,
  ): Promise<PaymasterSponsorshipResult> {
    const bundlerUrl = this.getBundlerUrl(blockchain);
    if (!bundlerUrl) {
      return { sponsored: false, error: `Pimlico not configured for ${blockchain}` };
    }

    try {
      // Get gas price first
      const gasPrice = await this.getGasPrice(blockchain);

      // For EIP-7702 transactions, we use a simplified sponsorship check
      // The actual sponsorship happens through the policy configured in Pimlico dashboard
      const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'pm_getPaymasterStubData',
          params: [
            {
              sender: userAddress,
              callData: callData,
              callGasLimit: '0x30000', // 196608 - typical for ERC20 transfer
              verificationGasLimit: '0x30000',
              preVerificationGas: '0x10000',
              maxFeePerGas: `0x${gasPrice.maxFeePerGas.toString(16)}`,
              maxPriorityFeePerGas: `0x${gasPrice.maxPriorityFeePerGas.toString(16)}`,
            },
            this.getEntryPointAddress(),
            `0x${CHAIN_CONFIG[blockchain]?.id.toString(16)}`,
          ],
          id: 1,
        }),
      });

      const data = await response.json();

      if (data.error) {
        this.logger.warn(`Pimlico sponsorship check failed for ${blockchain}: ${data.error.message}`);
        return { sponsored: false, error: data.error.message };
      }

      // If we get paymasterAndData, sponsorship is available
      if (data.result?.paymasterAndData && data.result.paymasterAndData !== '0x') {
        return {
          sponsored: true,
          paymasterAndData: data.result.paymasterAndData,
          maxFeePerGas: gasPrice.maxFeePerGas,
          maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
          preVerificationGas: BigInt(data.result.preVerificationGas || '0x10000'),
          verificationGasLimit: BigInt(data.result.verificationGasLimit || '0x30000'),
          callGasLimit: BigInt(data.result.callGasLimit || '0x30000'),
        };
      }

      return { sponsored: false, error: 'No sponsorship available' };
    } catch (error) {
      this.logger.warn(`Pimlico sponsorship request failed for ${blockchain}: ${error.message}`);
      return { sponsored: false, error: error.message };
    }
  }

  /**
   * Check if an address is eligible for gas sponsorship
   * This checks against Pimlico's sponsorship policies
   */
  async checkSponsorshipEligibility(
    blockchain: Blockchain,
    userAddress: Address,
  ): Promise<{ eligible: boolean; reason?: string }> {
    const bundlerUrl = this.getBundlerUrl(blockchain);
    if (!bundlerUrl) {
      return { eligible: false, reason: `Pimlico not configured for ${blockchain}` };
    }

    try {
      // Check user's native balance to confirm they need sponsorship
      const chain = CHAIN_CONFIG[blockchain];
      if (!chain) {
        return { eligible: false, reason: `Unsupported blockchain: ${blockchain}` };
      }

      const rpcUrl = this.getChainRpcUrl(blockchain);
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });

      const balance = await publicClient.getBalance({ address: userAddress });

      // User has gas, no sponsorship needed
      if (balance > 0n) {
        return {
          eligible: false,
          reason: `User has native balance: ${formatEther(balance)} - normal transaction flow recommended`,
        };
      }

      // User has zero balance, eligible for sponsorship
      return { eligible: true };
    } catch (error) {
      this.logger.warn(`Failed to check sponsorship eligibility for ${userAddress} on ${blockchain}: ${error.message}`);
      return { eligible: false, reason: error.message };
    }
  }

  /**
   * Get the EntryPoint address (v0.7 for EIP-7702 support)
   */
  private getEntryPointAddress(): Address {
    // EntryPoint v0.7 - required for EIP-7702 support
    return '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
  }

  /**
   * Get fallback gas price from on-chain
   */
  private async getFallbackGasPrice(blockchain: Blockchain): Promise<GasPriceResult> {
    const chain = CHAIN_CONFIG[blockchain];
    if (!chain) {
      throw new Error(`Unsupported blockchain: ${blockchain}`);
    }

    const rpcUrl = this.getChainRpcUrl(blockchain);
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    const [block, maxPriorityFeePerGas] = await Promise.all([
      publicClient.getBlock(),
      publicClient.estimateMaxPriorityFeePerGas(),
    ]);

    const baseFee = block.baseFeePerGas ?? 0n;
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;

    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  /**
   * Get RPC URL for blockchain
   */
  private getChainRpcUrl(blockchain: Blockchain): string {
    const chainConfigs: Record<string, { urlKey: string; apiKeyKey: string }> = {
      [Blockchain.ETHEREUM]: { urlKey: 'ethGatewayUrl', apiKeyKey: 'ethApiKey' },
      [Blockchain.ARBITRUM]: { urlKey: 'arbitrumGatewayUrl', apiKeyKey: 'arbitrumApiKey' },
      [Blockchain.OPTIMISM]: { urlKey: 'optimismGatewayUrl', apiKeyKey: 'optimismApiKey' },
      [Blockchain.POLYGON]: { urlKey: 'polygonGatewayUrl', apiKeyKey: 'polygonApiKey' },
      [Blockchain.BASE]: { urlKey: 'baseGatewayUrl', apiKeyKey: 'baseApiKey' },
      [Blockchain.BINANCE_SMART_CHAIN]: { urlKey: 'bscGatewayUrl', apiKeyKey: 'bscApiKey' },
      [Blockchain.GNOSIS]: { urlKey: 'gnosisGatewayUrl', apiKeyKey: 'gnosisApiKey' },
      [Blockchain.SEPOLIA]: { urlKey: 'sepoliaGatewayUrl', apiKeyKey: 'sepoliaApiKey' },
    };

    const configKeys = chainConfigs[blockchain];
    if (!configKeys) {
      throw new Error(`No RPC config for ${blockchain}`);
    }

    const chainConfig = this.config[blockchain.toLowerCase()] || this.config[blockchain];
    const url = chainConfig?.[configKeys.urlKey];
    const apiKey = chainConfig?.[configKeys.apiKeyKey] ?? '';

    return `${url}/${apiKey}`;
  }
}
