import { Config } from 'src/config/config';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Util } from 'src/shared/utils/util';
import { FeeResult, PayoutTxStatus } from 'src/subdomains/supporting/payout/interfaces';
import { PriceCurrency, PriceValidity } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutEvmService } from '../../../../services/payout-evm.service';
import { PayoutStrategy } from './payout.strategy';

export abstract class EvmStrategy extends PayoutStrategy {
  private readonly logger = new DfxLogger(EvmStrategy);

  constructor(
    protected readonly payoutEvmService: PayoutEvmService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  protected abstract dispatchPayout(order: PayoutOrder): Promise<string>;
  protected abstract getCurrentGasForTransaction(amount: number, token: Asset): Promise<number>;

  async estimateFee(targetAsset: Asset, _address: string, amount: number, _asset: Asset): Promise<FeeResult> {
    const gasPerTransaction = await this.getCurrentGasForTransaction(amount, targetAsset);

    return { asset: await this.feeAsset(), amount: gasPerTransaction };
  }

  async estimateBlockchainFee(asset: Asset): Promise<FeeResult> {
    // Amount-independent preview: gas cost for plain ERC-20 / coin transfers does not depend on
    // the transferred amount. Use 1 wei (minimal non-zero amount) to avoid balance-related
    // estimateGas reverts on the dex wallet.
    const previewAmount = EvmUtil.fromWeiAmount(1, asset.decimals);
    const gasPerTransaction = await this.getCurrentGasForTransaction(previewAmount, asset);

    return { asset: await this.feeAsset(), amount: gasPerTransaction };
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
        const status = await this.getPayoutCompletionData(order.payoutTxId);

        if (status.state === 'complete') {
          order.complete();

          const feeAsset = await this.feeAsset();
          const price = await this.pricingService.getPrice(feeAsset, PriceCurrency.CHF, PriceValidity.ANY);
          order.recordPayoutFee(feeAsset, status.fee, price.convert(status.fee, Config.defaultVolumeDecimal));

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
            order.rollbackPayout();
            await this.payoutOrderRepo.save(order);
          } else {
            // TX expired (not on-chain, not in mempool) - retry immediately, no gas costs incurred
            this.logger.info(`Payout order ${order.id} has expired TX (${order.payoutTxId}), retrying immediately`);
          }
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
