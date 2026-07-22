import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { ChainSwapId, LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { PurchaseLiquidityRequest } from '../../../../interfaces';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.strategy';

export interface PurchaseDexService {
  getTargetAmount(referenceAsset: Asset, referenceAmount: number, targetAsset: Asset): Promise<number>;
  swap(swapAsset: Asset, swapAmount: number, targetAsset: Asset, maxPriceSlippage: number): Promise<ChainSwapId>;
  getSwapResult(
    txId: string,
    asset: Asset,
  ): Promise<{
    targetAmount: number;
    feeAmount: number;
    targetAmountBaseUnits?: bigint | null;
    feeAmountBaseUnits?: bigint | null;
  }>;
}

export abstract class PurchaseStrategy extends PurchaseLiquidityStrategy {
  constructor(protected readonly dexService: PurchaseDexService) {
    super();
  }

  //*** PUBLIC API ***//

  async purchaseLiquidity(request: PurchaseLiquidityRequest): Promise<void> {
    const order = this.liquidityOrderFactory.createPurchaseOrder(request, this.blockchain, this.constructor.name);

    // Persist BEFORE the swap (fail-closed, mirrors payout #4181): the row is the in-flight
    // marker, and the partial unique index rejects a concurrent duplicate purchase for the same
    // (context, correlationId) here, before anything reaches the chain.
    await this.liquidityOrderRepo.save(order);

    try {
      await this.bookLiquiditySwap(order);
    } catch (e) {
      if (e instanceof TxBroadcastError || order.txId != null) {
        // The dispatch boundary was reached (or a txId was already returned), so the transaction may
        // be in-flight. Keep the marker unchanged; its unique index guard blocks a blind re-purchase
        // until an operator investigates.
        throw e;
      }

      // A plain error occurred before the send boundary. Cancelling removes this completed row from
      // the partial index and preserves the existing retry-on-next-cron behavior.
      order.cancel();
      await this.liquidityOrderRepo.save(order);
      throw e;
    }

    // Persist the transaction ID as soon as the dispatch returns. Estimation is deliberately later:
    // if it fails, finalizePurchaseOrders can still pick up the already-broadcast transaction.
    await this.liquidityOrderRepo.save(order);

    this.logger.verbose(
      `Booked purchase of ${order.referenceAmount} ${order.referenceAsset.dexName} worth liquidity for asset ${order.targetAsset.dexName}. Context: ${order.context}. CorrelationId: ${order.correlationId}.`,
    );

    try {
      await this.estimateTargetAmount(order);
      await this.liquidityOrderRepo.save(order);
    } catch (e) {
      await this.handlePurchaseLiquidityError(e, request);
    }
  }

  async addPurchaseData(order: LiquidityOrder): Promise<void> {
    const { targetAmount, feeAmount, targetAmountBaseUnits, feeAmountBaseUnits } = await this.dexService.getSwapResult(
      order.txId,
      order.targetAsset,
    );

    order.purchased(targetAmount);
    // §2.3 native-first exactness (#4287 stage 2): keep the exact swap-output wei ONLY when purchased() booked
    // the on-chain output verbatim. setTargetAmount rewrites targetAmount to referenceAmount when
    // reference==target (dexName), so the captured integer would no longer represent order.targetAmount → drop
    // it (fail-open, derive from the float).
    order.targetAmountBaseUnits = order.targetAmount === targetAmount ? (targetAmountBaseUnits ?? null) : null;
    order.recordFee(await this.feeAsset(), feeAmount);
    // §2.3 exactness (#4287 stage 3): recordFee stores feeAmount verbatim, so keep its EXACT gas-fee wei alongside;
    // the ledger books the network-fee leg verbatim. null -> derive from the float (fail-open).
    order.feeAmountBaseUnits = feeAmountBaseUnits ?? null;
    await this.liquidityOrderRepo.save(order);
  }

  //*** HELPER METHODS ***//

  private async bookLiquiditySwap(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset, maxPriceSlippage } = order;

    const txId = await this.dexService.swap(referenceAsset, referenceAmount, targetAsset, maxPriceSlippage);
    order.addBlockchainTransactionMetadata(txId, referenceAsset, referenceAmount);
    // §2.3 native-first exactness (#4287 stage 2): the EXACT wei that entered the DfxDex swap = referenceAmount
    // scaled at the broadcast resolution (toBroadcastBaseUnits mirrors client.swap's toWeiAmount; coin=18 /
    // token=decimals guard). PurchaseStrategy is EVM-only (non-EVM uses NoPurchaseStrategy). Fail-open null →
    // the ledger derives from the float.
    order.swapAmountBaseUnits = EvmUtil.toBroadcastBaseUnits(referenceAmount, referenceAsset);
  }

  private async estimateTargetAmount(order: LiquidityOrder): Promise<void> {
    const { referenceAsset, referenceAmount, targetAsset } = order;

    const estimatedTargetAmount = await this.dexService.getTargetAmount(referenceAsset, referenceAmount, targetAsset);

    order.addEstimatedTargetAmount(estimatedTargetAmount);
  }
}
