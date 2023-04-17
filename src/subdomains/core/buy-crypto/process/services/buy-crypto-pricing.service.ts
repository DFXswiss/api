import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { BuyCryptoBatch } from '../entities/buy-crypto-batch.entity';
import { BuyCryptoNotificationService } from './buy-crypto-notification.service';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';

@Injectable()
export class BuyCryptoPricingService {
  constructor(
    private readonly priceProvider: PriceProviderService,
    private readonly buyCryptoNotificationService: BuyCryptoNotificationService,
  ) {}

  //*** PUBLIC API ***//

  async getFeeAmountInBatchAsset(
    batch: BuyCryptoBatch,
    nativeFee: FeeResult,
    priceRequestCorrelationId: string,
    errorMessage: string,
  ): Promise<number | null> {
    try {
      return nativeFee.amount
        ? await this.convertToTargetAsset(nativeFee.asset, nativeFee.amount, batch.outputReferenceAsset)
        : 0;
    } catch (e) {
      console.error('Failed to convert fee amount:', e);

      await this.handleFeeConversionError(
        nativeFee.asset.dexName,
        batch.outputReferenceAsset.dexName,
        errorMessage,
        e,
        priceRequestCorrelationId,
      );

      return null;
    }
  }

  //*** HELPER METHODS ***//

  private async convertToTargetAsset(sourceAsset: Asset, sourceAmount: number, targetAsset: Asset): Promise<number> {
    const result = await this.priceProvider.getPrice(sourceAsset, targetAsset);

    return result.price ? Util.round(sourceAmount / result.price, 8) : 0;
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
}
