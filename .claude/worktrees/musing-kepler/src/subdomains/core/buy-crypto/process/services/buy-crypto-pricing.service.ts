import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PriceValidity, PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';

@Injectable()
export class BuyCryptoPricingService {
  constructor(private readonly pricingService: PricingService) {}

  //*** PUBLIC API ***//

  async getFeeAmountInRefAsset(refAsset: Asset, nativeFee: FeeResult): Promise<number> {
    return nativeFee.amount ? this.convertToTargetAsset(nativeFee.asset, nativeFee.amount, refAsset) : 0;
  }

  //*** HELPER METHODS ***//

  // allows expired prices!
  private async convertToTargetAsset(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    const price = await this.pricingService.getPrice(sourceAsset, targetAsset, PriceValidity.ANY);

    return price.convert(sourceAmount, 8);
  }
}
