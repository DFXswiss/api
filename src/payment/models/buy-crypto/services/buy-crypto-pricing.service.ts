import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/util';
import { PriceRequestContext } from '../../pricing/enums';
import { PriceRequest } from '../../pricing/interfaces';
import { PricingService } from '../../pricing/services/pricing.service';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';

@Injectable()
export class BuyCryptoPricingService {
  constructor(private readonly pricingService: PricingService) {}

  async convertToTargetAsset(
    batch: BuyCryptoBatch,
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    correlation: string,
  ): Promise<number> {
    const priceRequest = this.createPriceRequest(batch, [sourceAsset.dexName, targetAsset.dexName], correlation);

    const { price } = await this.pricingService.getPrice(priceRequest).catch((e) => {
      console.error('Failed to get price:', e);
      return undefined;
    });

    return Util.round(sourceAmount * price.price, 8);
  }

  //*** HELPER METHODS ***//

  private createPriceRequest(batch: BuyCryptoBatch, currencyPair: string[], correlation: string): PriceRequest {
    const correlationId = `BuyCryptoBatch_${batch.id}_${correlation}`;
    return { context: PriceRequestContext.BUY_CRYPTO, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }
}
