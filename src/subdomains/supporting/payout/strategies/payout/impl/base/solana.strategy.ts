import { Config } from 'src/config/config';
import { SolanaUtil } from 'src/integration/blockchain/solana/solana.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutOrderRepository } from 'src/subdomains/supporting/payout/repositories/payout-order.repository';
import { PayoutSolanaService } from 'src/subdomains/supporting/payout/services/payout-solana.service';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutStrategy } from './payout.strategy';

export abstract class SolanaStrategy extends PayoutStrategy {
  private readonly logger = new DfxLogger(SolanaStrategy);

  private readonly txFees = new AsyncCache<number>(CacheItemResetPeriod.EVERY_30_SECONDS);

  constructor(
    protected readonly solanaService: PayoutSolanaService,
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
        if (!(await this.designateBeforeBroadcast(order, this.payoutOrderRepo))) continue;

        const txId = await this.dispatchPayout(order);
        order.pendingPayout(txId);
        // §2.3 native-first exactness (issue #4287 stage 3): capture the EXACT integer base units that left custody at
        // the broadcast lamports/token resolution (coin@9-guard / token@decimals); the ledger books it verbatim on the
        // withdrawal wallet leg. null (unknown/incompatible decimals) -> derive from the float (fail-open).
        order.amountBaseUnits = SolanaUtil.toBroadcastBaseUnits(order.amount, order.asset);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        this.logger.error(`Error while executing Solana payout order ${order.id}:`, e);

        await this.handleBroadcastError(order, e, this.payoutOrderRepo);
      }
    }
  }

  async checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const [isComplete, payoutFee, feeBaseUnits] = await this.getPayoutCompletionData(order.payoutTxId);

        if (isComplete) {
          order.complete();

          const feeAsset = await this.feeAsset();
          const price = await this.pricingService.getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
          order.recordPayoutFee(feeAsset, payoutFee, price.convert(payoutFee, Config.defaultVolumeDecimal));
          // §2.3 exactness (issue #4287): persist the EXACT fee lamports so the ledger books the network-fee leg
          // verbatim, but ONLY when the fee asset (SOL) is at the lamports scale (9 dp) the captured integer is in —
          // else the verbatim booking would be mis-scaled -> null (derive from the float). Mirrors the coin@9 guard.
          order.payoutFeeAmountBaseUnits = feeAsset.decimals === SolanaUtil.coinDecimals ? feeBaseUnits : null;

          await this.payoutOrderRepo.save(order);
        }
      } catch (e) {
        this.logger.error(`Error in checking completion of Solana payout order ${order.id}:`, e);
      }
    }
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number, bigint | null]> {
    return this.solanaService.getPayoutCompletionData(payoutTxId);
  }
}
