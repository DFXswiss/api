import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { BitcoinClient } from '../node/bitcoin-client';
import { BitcoinNodeType, BitcoinService } from '../node/bitcoin.service';

export type TxFeeRateStatus = 'unconfirmed' | 'confirmed' | 'not_found' | 'error';

export interface TxFeeRateResult {
  status: TxFeeRateStatus;
  feeRate?: number;
}

@Injectable()
export class BitcoinFeeService {
  private readonly logger = new DfxLogger(BitcoinFeeService);
  private readonly client: BitcoinClient;

  // Thread-safe cache with fallback support
  private readonly feeRateCache = new AsyncCache<number>(CacheItemResetPeriod.EVERY_30_SECONDS);
  private readonly txFeeRateCache = new AsyncCache<TxFeeRateResult>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(bitcoinService: BitcoinService) {
    this.client = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_INPUT);
  }

  async getRecommendedFeeRate(): Promise<number> {
    return this.feeRateCache.get(
      'fastestFee',
      async () => {
        const feeRate = await this.client.estimateSmartFee(1);
        if (feeRate === null) {
          throw new Error('Failed to estimate fee rate from Bitcoin node');
        }
        return feeRate;
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
