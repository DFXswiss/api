import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutEvmService } from '../../../../services/payout-evm.service';
import { PayoutStrategy } from './payout.strategy';

export abstract class EvmStrategy extends PayoutStrategy {
  private readonly logger = new DfxLogger(EvmStrategy);

  private readonly txFees = new AsyncCache<number>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(
    protected readonly payoutEvmService: PayoutEvmService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  protected abstract dispatchPayout(order: PayoutOrder): Promise<string>;
  protected abstract getCurrentGasForTransaction(token?: Asset): Promise<number>;

  async estimateFee(asset: Asset): Promise<FeeResult> {
    const gasPerTransaction = await this.txFees.get(asset.id.toString(), () => this.getCurrentGasForTransaction(asset));

    return { asset: await this.feeAsset(), amount: gasPerTransaction };
  }

  async estimateBlockchainFee(asset: Asset): Promise<FeeResult> {
    return this.estimateFee(asset);
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const txId = await this.dispatchPayout(order);
        order.pendingPayout(txId);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        this.logger.error(`Error while executing EVM payout order ${order.id}:`, e);
      }
    }
  }

  async checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const [isComplete, payoutFee] = await this.getPayoutCompletionData(order.payoutTxId);

        if (isComplete) {
          order.complete();

          const feeAsset = await this.feeAsset();
          const price = await this.pricingService.getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
          order.recordPayoutFee(feeAsset, payoutFee, price.convert(payoutFee, Config.defaultVolumeDecimal));

          await this.payoutOrderRepo.save(order);
        } else if (await this.canRetryFailedPayout(order)) {
          // TX expired (not on-chain, not in mempool) - retry immediately, no gas costs incurred
          this.logger.info(`Payout order ${order.id} has expired TX (${order.payoutTxId}), retrying immediately`);
          await this.doPayout([order]);
        }
      } catch (e) {
        this.logger.error(`Error in checking completion of EVM payout order ${order.id}:`, e);
      }
    }
  }

  protected async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.payoutEvmService.getPayoutCompletionData(payoutTxId);
  }

  protected async getOrderNonce(order: PayoutOrder): Promise<number | undefined> {
    if (order.payoutTxId && !DisabledProcess(Process.TX_SPEEDUP)) {
      return this.payoutEvmService.getTxNonce(order.payoutTxId);
    }
  }

  override async canRetryFailedPayout(order: PayoutOrder): Promise<boolean> {
    if (!order.payoutTxId) return false;

    if (Util.hoursDiff(order.updated) < 1) return false;

    return this.payoutEvmService.isTxExpired(order.payoutTxId);
  }
}
