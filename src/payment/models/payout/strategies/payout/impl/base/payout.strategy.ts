import { FeeResult } from 'src/payment/models/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder } from '../../../../entities/payout-order.entity';

export abstract class PayoutStrategy {
  #feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    return this.#feeAsset ?? (await this.getFeeAsset());
  }

  abstract doPayout(orders: PayoutOrder[]): Promise<void>;
  abstract checkPayoutCompletionData(order: PayoutOrder): Promise<void>;
  abstract estimateFee(quantityOfTransactions: number, asset: Asset): Promise<FeeResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
