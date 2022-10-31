import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/util';
import { FeeResult } from '../../payout/interfaces';
import { PriceRequestContext } from '../../pricing/enums';
import { PriceRequest, PriceResult } from '../../pricing/interfaces';
import { PricingService } from '../../pricing/services/pricing.service';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';

@Injectable()
export class BuyCryptoPricingService {
  constructor(
    private readonly pricingService: PricingService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
  ) {}

  //*** PUBLIC API ***//

  async getFeeAmountInBatchAsset(
    batch: BuyCryptoBatch,
    nativeFee: FeeResult,
    priceRequestCorrelationId: string,
    errorMessage: string,
  ): Promise<number> {
    try {
      return nativeFee.amount
        ? await this.convertToTargetAsset(
            nativeFee.asset,
            nativeFee.amount,
            batch.outputReferenceAsset,
            priceRequestCorrelationId,
          )
        : 0;
    } catch (e) {
      console.error(errorMessage, e);

      await this.handleFeeConversionError(
        nativeFee.asset.dexName,
        batch.outputReferenceAsset.dexName,
        errorMessage,
        e,
        priceRequestCorrelationId,
      );

      return 0;
    }
  }

  //*** HELPER METHODS ***//

  private async convertToTargetAsset(
    sourceAsset: Asset,
    sourceAmount: number,
    targetAsset: Asset,
    correlationId: string,
  ): Promise<number> {
    const priceRequest = this.createPriceRequest([sourceAsset.dexName, targetAsset.dexName], correlationId);

    const result = (await this.pricingService.getPrice(priceRequest).catch((e) => {
      console.error('Failed to get price:', e);
      return undefined;
    })) as PriceResult | undefined;

    if (!result) {
      throw new Error(
        `Could not get price from source asset: ${sourceAsset.dexName} to target asset: ${targetAsset.dexName}`,
      );
    }

    return Util.round(sourceAmount * result.price.price, 8);
  }

  private async handleFeeConversionError(
    nativeAssetName: string,
    referenceAssetName: string,
    message: string,
    error: Error,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.buyCryptoNotificationService.sendFeeConversionError(
        nativeAssetName,
        referenceAssetName,
        message,
        error,
      );
    } catch (e) {
      console.error(`Error in handling fee calculation error. Correlation: ${correlationId}`, e);
    }
  }

  private createPriceRequest(currencyPair: string[], correlationId: string): PriceRequest {
    return { context: PriceRequestContext.BUY_CRYPTO, correlationId, from: currencyPair[0], to: currencyPair[1] };
  }
}
