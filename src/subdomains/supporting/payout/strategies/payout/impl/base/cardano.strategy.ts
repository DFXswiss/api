import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutOrderRepository } from 'src/subdomains/supporting/payout/repositories/payout-order.repository';
import { PayoutCardanoService } from 'src/subdomains/supporting/payout/services/payout-cardano.service';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutStrategy } from './payout.strategy';

export abstract class CardanoStrategy extends PayoutStrategy {
  private readonly logger = new DfxLogger(CardanoStrategy);

  private readonly txFees = new AsyncCache<number>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(
    protected readonly cardanoService: PayoutCardanoService,
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
        // Persist the designation BEFORE broadcasting (fail-closed, mirrors the Bitcoin path):
        // a reboot between broadcast and save must not leave the order re-selectable by the 30s
        // cron, which would double-pay. The guard keeps the TX_SPEEDUP/expired-retry path
        // (payoutTxId already set) untouched so nonce-reuse semantics stay intact.
        if (!order.payoutTxId) {
          order.designatePayout();
          await this.payoutOrderRepo.save(order);
        }

        const txId = await this.dispatchPayout(order);
        order.pendingPayout(txId);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        // Fail-closed: only log. The order stays PAYOUT_DESIGNATED so processFailedOrders moves
        // it to PayoutUncertain for manual investigation. Never rollback here — after
        // dispatchPayout throws it is not provable that the broadcast was suppressed, and a
        // wrong auto-retry would double-pay.
        this.logger.error(`Error while executing Cardano payout order ${order.id}:`, e);
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
        }
      } catch (e) {
        this.logger.error(`Error in checking completion of Cardano payout order ${order.id}:`, e);
      }
    }
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    return this.cardanoService.getPayoutCompletionData(payoutTxId);
  }
}
