import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
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

// Node's own minimum relay fee floor (sat/vB); broadcasts below this are rejected outright.
const MIN_FEE_RATE_SAT_VB = 1;

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

    // Bitcoin Core's send RPC parses fee_rate with decimals=3; un-rounded floating-point
    // products (e.g. 1.935 * 2 = 3.8699999999999997) are rejected with "Invalid amount".
    // estimateSmartFee can also return an estimate below the node's own minimum relay fee
    // during periods of very low mempool activity, so clamp the value that is actually
    // broadcast to that floor; the raw estimate from getRecommendedFeeRate() stays unclamped.
    return Math.max(Util.round(baseRate * multiplier, 3), MIN_FEE_RATE_SAT_VB);
  }
}
