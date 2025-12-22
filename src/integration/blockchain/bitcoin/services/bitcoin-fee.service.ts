import { Injectable } from '@nestjs/common';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';

interface MempoolTxResponse {
  txid: string;
  fee: number;
  weight: number;
  status: {
    confirmed: boolean;
    block_height?: number;
  };
}

export type TxFeeRateStatus = 'unconfirmed' | 'confirmed' | 'not_found' | 'error';

export interface TxFeeRateResult {
  status: TxFeeRateStatus;
  feeRate?: number;
}

@Injectable()
export class BitcoinFeeService {
  private readonly logger = new DfxLogger(BitcoinFeeService);

  private readonly btcFeeUrl = 'https://mempool.space/api/v1/fees/recommended';
  private readonly btcTxUrl = 'https://mempool.space/api/tx';

  // Thread-safe cache with fallback support
  private readonly feeRateCache = new AsyncCache<number>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(private readonly http: HttpService) {}

  async getRecommendedFeeRate(): Promise<number> {
    return this.feeRateCache.get(
      'fastestFee',
      async () => {
        const { fastestFee } = await this.http.get<{
          fastestFee: number;
          halfHourFee: number;
          hourFee: number;
          economyFee: number;
          minimumFee: number;
        }>(this.btcFeeUrl, {
          tryCount: 3,
        });
        return fastestFee;
      },
      undefined,
      true, // fallbackToCache on error
    );
  }

  async getTxFeeRate(txid: string): Promise<TxFeeRateResult> {
    try {
      const tx = await this.http.get<MempoolTxResponse>(`${this.btcTxUrl}/${txid}`, {
        tryCount: 3,
      });

      if (!tx) {
        return { status: 'not_found' };
      }

      if (tx.status.confirmed) {
        return { status: 'confirmed' };
      }

      // Fee rate = fee / (weight / 4) = sat/vB
      const feeRate = tx.fee / (tx.weight / 4);
      return { status: 'unconfirmed', feeRate };
    } catch (e) {
      // Check for 404 - TX not found
      if (e.response?.status === 404 || e.status === 404) {
        return { status: 'not_found' };
      }
      // Return error status instead of throwing (consistent with batch method)
      this.logger.error(`Failed to get TX fee rate for ${txid}:`, e);
      return { status: 'error' };
    }
  }

  async getTxFeeRates(txids: string[]): Promise<Map<string, TxFeeRateResult>> {
    const results = new Map<string, TxFeeRateResult>();

    // Parallel fetch - errors are now handled consistently in getTxFeeRate
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
