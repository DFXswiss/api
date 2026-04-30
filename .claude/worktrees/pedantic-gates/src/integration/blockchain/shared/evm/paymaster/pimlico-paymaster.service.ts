import { Injectable } from '@nestjs/common';
import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { EVM_CHAIN_CONFIG } from '../evm-chain.config';

/**
 * Service for Pimlico paymaster integration (EIP-5792 wallet_sendCalls)
 *
 * Pimlico provides ERC-7677 compliant paymaster URLs that can be used with
 * EIP-5792 wallet_sendCalls to sponsor gas for users.
 */
@Injectable()
export class PimlicoPaymasterService {
  private readonly config = GetConfig().blockchain;

  private get apiKey(): string | undefined {
    return this.config.evm.pimlicoApiKey;
  }

  /**
   * Check if paymaster is available for the given blockchain
   * Requires PIMLICO_API_KEY environment variable to be set
   */
  isPaymasterAvailable(blockchain: Blockchain): boolean {
    if (!this.apiKey) return false;
    return EVM_CHAIN_CONFIG[blockchain]?.pimlicoName !== undefined;
  }

  /**
   * Get Pimlico bundler URL with paymaster capability
   * Format: https://api.pimlico.io/v2/{chain}/rpc?apikey={API_KEY}
   */
  getBundlerUrl(blockchain: Blockchain): string | undefined {
    if (!this.isPaymasterAvailable(blockchain)) return undefined;

    const chainName = EVM_CHAIN_CONFIG[blockchain]?.pimlicoName;
    return `https://api.pimlico.io/v2/${chainName}/rpc?apikey=${this.apiKey}`;
  }
}
