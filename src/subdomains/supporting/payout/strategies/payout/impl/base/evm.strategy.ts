import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { FeeResult, PayoutTxStatus } from 'src/subdomains/supporting/payout/interfaces';
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

  override get supportsSpeedup(): boolean {
    return true;
  }

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
        order.resetPayoutRetry();
        order.pendingPayout(txId);
        order.amountBaseUnits = this.sentBaseUnits(order);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        this.logger.error(`Error while executing EVM payout order ${order.id}:`, e);

        await this.handleBroadcastError(order, e, this.payoutOrderRepo);
      }
    }
  }

  // §2.3 native-first exactness (issue #4287 stage 1): the EXACT integer base units that actually left custody on-chain,
  // captured to be TAUTOLOGICALLY equal to the broadcast by scaling with the SAME decimals evm-client uses — so the
  // stored integer can never diverge from what was sent. A native COIN is ALWAYS broadcast via parseEther = 18 dp
  // (evm-client.ts:853/873) irrespective of the asset's configured decimals, so a coin is captured ONLY at 18 dp; a coin
  // misconfigured with decimals ≠ 18 would otherwise store a value diverging from the sent amount → fail-open to null
  // (derive) instead of persisting a wrong exact figure. A TOKEN is broadcast via parseUnits(amount, token.decimals)
  // (evm-client.ts:885) = asset.decimals. For a >8-dp asset (every EVM 18-dp coin/token) the result DIFFERS from the
  // ≤8-dp float derivation (toBaseUnits caps at 8 dp); the ledger books it verbatim on the withdrawal wallet leg.
  // Scaling is string/BigNumber-based (no float step beyond order.amount). Additive/fail-open: unknown/incompatible
  // decimals → null → derive as before.
  private sentBaseUnits(order: PayoutOrder): bigint | null {
    const decimals = order.asset?.decimals;
    if (decimals == null) return null;
    // a native coin is broadcast at 18 dp (parseEther) regardless of asset.decimals — never store a divergent value
    if (this.assetType === AssetType.COIN && decimals !== 18) return null;
    try {
      return BigInt(EvmUtil.toWeiAmount(order.amount, decimals).toString());
    } catch {
      return null;
    }
  }

  async checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const status = await this.getPayoutCompletionData(order.payoutTxId);

        if (status.state === 'complete') {
          order.complete();

          const feeAsset = await this.feeAsset();
          const price = await this.pricingService.getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
          order.recordPayoutFee(feeAsset, status.fee, price.convert(status.fee, Config.defaultVolumeDecimal));
          // §2.3 exactness (#4287 stage 3): also persist the EXACT gas-fee wei so the ledger books the network-fee leg
          // verbatim; null (capture error) -> the ledger derives from the float (fail-open).
          order.payoutFeeAmountBaseUnits = status.feeBaseUnits;

          await this.payoutOrderRepo.save(order);
        } else if (status.state === 'failed' && !status.isOutOfGas) {
          // Non-recoverable on-chain revert (paused contract, balance mismatch, etc.).
          // Designate for investigation - processFailedOrders will mail and move to PayoutUncertain.
          this.logger.error(`Payout order ${order.id} reverted on-chain (tx ${order.payoutTxId}, not OOG)`);
          order.designatePayout();
          await this.payoutOrderRepo.save(order);
        } else if (await this.canRetryFailedPayout(order, status)) {
          if (status.state === 'failed' && status.isOutOfGas) {
            // OOG: free the spent nonce so the retry gets a fresh one
            this.logger.warn(
              `Payout order ${order.id} failed with out-of-gas (tx ${order.payoutTxId}), retrying with fresh nonce`,
            );
          } else {
            // Expired (vanished from the mempool): getTxNonce on the vanished hash resolves undefined,
            // so a re-entry with payoutTxId set would broadcast an INDEPENDENT tx with a fresh nonce,
            // outside the designate-before-broadcast protection. Roll back like the OOG path so the
            // retry re-enters the regular protected flow (designation persisted before dispatch,
            // ambiguous failures escalate instead of silently looping).
            this.logger.warn(
              `Payout order ${order.id} has expired TX (${order.payoutTxId}), retrying with fresh designation`,
            );
          }
          if (!(await this.rollbackBroadcastForRetry(order, this.payoutOrderRepo))) continue;
          await this.doPayout([order]);
        }
      } catch (e) {
        this.logger.error(`Error in checking completion of EVM payout order ${order.id}:`, e);
      }
    }
  }

  protected async getPayoutCompletionData(payoutTxId: string): Promise<PayoutTxStatus> {
    return this.payoutEvmService.getPayoutCompletionData(payoutTxId);
  }

  protected async getOrderNonce(order: PayoutOrder): Promise<number | undefined> {
    if (order.payoutTxId && !DisabledProcess(Process.TX_SPEEDUP)) {
      return this.payoutEvmService.getTxNonce(order.payoutTxId);
    }
  }

  override async canRetryFailedPayout(order: PayoutOrder, status?: PayoutTxStatus): Promise<boolean> {
    if (!order.payoutTxId) return false;

    // OOG-mined: retry immediately, re-estimation should resolve the state divergence
    if (status?.state === 'failed' && status.isOutOfGas) return true;

    // Expired in mempool: retry after 1h cooldown
    if (Util.hoursDiff(order.updated) < 1) return false;
    return this.payoutEvmService.isTxExpired(order.payoutTxId);
  }
}
