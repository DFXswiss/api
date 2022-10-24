import { FeeResult } from 'src/payment/models/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutEvmService } from '../../../../services/payout-evm.service';
import { PayoutStrategy } from './payout.strategy';

export abstract class EvmStrategy extends PayoutStrategy {
  protected feeAsset: Asset;

  constructor(
    protected readonly payoutEvmService: PayoutEvmService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  protected abstract dispatchPayout(order: PayoutOrder): Promise<string>;
  protected abstract getCurrentGasForTransaction(token?: Asset): Promise<number>;
  protected abstract getFeeAsset(): Promise<Asset>;

  async estimateFee(quantityOfTransactions: number, asset: Asset): Promise<FeeResult> {
    const gasPerTransaction = await this.getCurrentGasForTransaction(asset);
    const feeAmount = quantityOfTransactions * gasPerTransaction;

    this.feeAsset = this.feeAsset ?? (await this.getFeeAsset());

    return { asset: this.feeAsset, amount: feeAmount };
  }

  async doPayout(orders: PayoutOrder[]): Promise<void> {
    for (const order of orders) {
      try {
        const txId = await this.dispatchPayout(order);
        order.pendingPayout(txId);

        await this.payoutOrderRepo.save(order);
      } catch (e) {
        console.error(`Error while executing EVM payout order. Order ID: ${order.id}`, e);
      }
    }
  }

  async checkPayoutCompletion(order: PayoutOrder): Promise<void> {
    try {
      const isComplete = await this.payoutEvmService.checkPayoutCompletion(order.payoutTxId);

      if (isComplete) {
        order.complete();

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking EVM payout order completion. Order ID: ${order.id}`, e);
    }
  }
}
