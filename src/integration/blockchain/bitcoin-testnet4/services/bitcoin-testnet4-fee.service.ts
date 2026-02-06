import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { BitcoinTestnet4Client } from '../bitcoin-testnet4-client';
import { BitcoinTestnet4NodeType, BitcoinTestnet4Service } from '../bitcoin-testnet4.service';

export type TxFeeRateStatus = 'unconfirmed' | 'confirmed' | 'not_found' | 'error';

export interface TxFeeRateResult {
  status: TxFeeRateStatus;
  feeRate?: number;
}

@Injectable()
export class BitcoinTestnet4FeeService {
  private readonly logger = new DfxLogger(BitcoinTestnet4FeeService);
  private readonly client: BitcoinTestnet4Client;

  // Thread-safe cache with fallback support
  private readonly feeRateCache = new AsyncCache<number>(CacheItemResetPeriod.EVERY_30_SECONDS);
  private readonly txFeeRateCache = new AsyncCache<TxFeeRateResult>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(bitcoinTestnet4Service: BitcoinTestnet4Service) {
    this.client = bitcoinTestnet4Service.getDefaultClient(BitcoinTestnet4NodeType.BTC_TESTNET4_OUTPUT);
  }

  async getRecommendedFeeRate(): Promise<number> {
    return this.feeRateCache.get(
      'fastestFee',
      async () => {
        const feeRate = await this.client.estimateSmartFee(1);

        if (feeRate === null) {
          this.logger.verbose('Fee estimation returned null, using minimum fee rate of 1 sat/vB');
          return 1;
        }

        return Math.max(feeRate, 1);
      },
      undefined,
      true, // fallbackToCache on error
    );
  }

  async getTxFeeRate(txid: string): Promise<TxFeeRateResult> {
    return this.txFeeRateCache.get(
      txid,
      async () => {
        try {
          const entry = await this.client.getMempoolEntry(txid);

          if (entry === null) {
            // TX not in mempool - either confirmed or doesn't exist
            // Check if TX exists in wallet
            const tx = await this.client.getTx(txid);
            if (tx && tx.confirmations > 0) {
              return { status: 'confirmed' as const };
            }
            return { status: 'not_found' as const };
          }

          return { status: 'unconfirmed' as const, feeRate: entry.feeRate };
        } catch (e) {
          this.logger.error(`Failed to get TX fee rate for ${txid}:`, e);
          return { status: 'error' as const };
        }
      },
      undefined,
      true, // fallbackToCache on error
    );
  }

  async getTxFeeRates(txids: string[]): Promise<Map<string, TxFeeRateResult>> {
    const results = new Map<string, TxFeeRateResult>();

    // Parallel fetch - errors are handled in getTxFeeRate
    const promises = txids.map(async (txid) => {
      const result = await this.getTxFeeRate(txid);
      return { txid, result };
    });

    const responses = await Promise.all(promises);

    for (const { txid, result } of responses) {
      results.set(txid, result);
    }

    return results;
  }
}
