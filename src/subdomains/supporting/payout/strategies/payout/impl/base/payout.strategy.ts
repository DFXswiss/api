import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder } from '../../../../entities/payout-order.entity';

export abstract class PayoutStrategy {
  private _feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract doPayout(orders: PayoutOrder[]): Promise<void>;
  abstract checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void>;
  abstract estimateFee(asset: Asset): Promise<FeeResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
