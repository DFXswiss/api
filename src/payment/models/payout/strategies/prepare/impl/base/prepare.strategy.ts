import { FeeResult } from 'src/payment/models/payout/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutOrder } from '../../../../entities/payout-order.entity';

export abstract class PrepareStrategy {
  #feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    return this.#feeAsset ?? (await this.getFeeAsset());
  }

  abstract preparePayout(order: PayoutOrder): Promise<void>;
  abstract checkPreparationCompletion(order: PayoutOrder): Promise<void>;
  abstract estimateFee(asset: Asset): Promise<FeeResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
