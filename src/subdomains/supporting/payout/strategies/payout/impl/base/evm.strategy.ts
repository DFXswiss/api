import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutEvmService } from '../../../../services/payout-evm.service';
import { PayoutStrategy } from './payout.strategy';

export abstract class EvmStrategy extends PayoutStrategy {
  constructor(
    protected readonly payoutEvmService: PayoutEvmService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
  ) {
    super();
  }

  protected abstract dispatchPayout(order: PayoutOrder): Promise<string>;
  protected abstract getCurrentGasForTransaction(token?: Asset): Promise<number>;

  async estimateFee(quantityOfTransactions: number, asset: Asset): Promise<FeeResult> {
    const gasPerTransaction = await this.getCurrentGasForTransaction(asset);
    const feeAmount = quantityOfTransactions * gasPerTransaction;

    return { asset: await this.feeAsset(), amount: feeAmount };
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

  async checkPayoutCompletionData(order: PayoutOrder): Promise<void> {
    try {
      const [isComplete, payoutFee] = await this.payoutEvmService.getPayoutCompletionData(order.payoutTxId);

      if (isComplete) {
        order.complete();
        order.recordPayoutFee(await this.feeAsset(), payoutFee);

        await this.payoutOrderRepo.save(order);
      }
    } catch (e) {
      console.error(`Error in checking EVM payout order completion. Order ID: ${order.id}`, e);
    }
  }
}
