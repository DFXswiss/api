import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder } from '../../../../entities/payout-order.entity';

export abstract class PayoutStrategy {
  private _feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    if (!this._feeAsset) {
      this._feeAsset = await this.getFeeAsset();
    }

    return this._feeAsset;
  }

  abstract doPayout(orders: PayoutOrder[]): Promise<void>;
  abstract checkPayoutCompletionData(order: PayoutOrder): Promise<void>;
  abstract estimateFee(quantityOfTransactions: number, asset: Asset): Promise<FeeResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
