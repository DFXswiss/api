import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { NodeClient } from '../node/node-client';

export type TxFeeRateStatus = 'unconfirmed' | 'confirmed' | 'not_found' | 'error';

export interface TxFeeRateResult {
  status: TxFeeRateStatus;
  feeRate?: number;
}

export interface FeeConfig {
  allowUnconfirmedUtxos: boolean;
  cpfpFeeMultiplier: number;
  defaultFeeMultiplier: number;
}

export abstract class BitcoinBasedFeeService {
  private readonly logger = new DfxLogger(BitcoinBasedFeeService);

  private readonly feeRateCache = new AsyncCache<number>(CacheItemResetPeriod.EVERY_30_SECONDS);
  private readonly txFeeRateCache = new AsyncCache<TxFeeRateResult>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(protected readonly client: NodeClient) {}

  protected abstract get feeConfig(): FeeConfig;

  async getRecommendedFeeRate(): Promise<number> {
    return this.feeRateCache.get(
      'fastestFee',
      async () => {
        const feeRate = await this.client.estimateSmartFee(1);
        if (feeRate === null) {
          throw new Error('Failed to estimate fee rate from node');
        }
        return feeRate;
      },
      undefined,
      true,
    );
  }

  async getTxFeeRate(txid: string): Promise<TxFeeRateResult> {
    return this.txFeeRateCache.get(
      txid,
      async () => {
        try {
          const entry = await this.client.getMempoolEntry(txid);

          if (entry === null) {
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
      true,
    );
  }

  async getTxFeeRates(txids: string[]): Promise<Map<string, TxFeeRateResult>> {
    const results = new Map<string, TxFeeRateResult>();

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

  async getSendFeeRate(): Promise<number> {
    const baseRate = await this.getRecommendedFeeRate();

    const { allowUnconfirmedUtxos, cpfpFeeMultiplier, defaultFeeMultiplier } = this.feeConfig;
    const multiplier = allowUnconfirmedUtxos ? cpfpFeeMultiplier : defaultFeeMultiplier;

    return baseRate * multiplier;
  }
}
