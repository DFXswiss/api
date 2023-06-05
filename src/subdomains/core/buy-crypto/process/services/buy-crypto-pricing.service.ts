import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';

@Injectable()
export class BuyCryptoPricingService {
  constructor(private readonly priceProvider: PriceProviderService) {}

  //*** PUBLIC API ***//

  async getFeeAmountInBatchAsset(batch: BuyCryptoBatch, nativeFee: FeeResult): Promise<number> {
    return nativeFee.amount
      ? this.convertToTargetAsset(nativeFee.asset, nativeFee.amount, batch.outputReferenceAsset)
      : 0;
  }

  //*** HELPER METHODS ***//

  private async convertToTargetAsset(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    const price = await this.priceProvider.getPrice(sourceAsset, targetAsset);

    return price.convert(sourceAmount, 8);
  }
}
