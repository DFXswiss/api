import { Injectable } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { DexService } from '../../../dex/services/dex.service';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from '../../domain/interfaces';

@Injectable()
export class PricingDexService implements PricingProvider {
  readonly name = 'CoinGecko';

  constructor(private dexService: DexService, private assetService: AssetService) {}

  async getPrice(from: string, to: string): Promise<Price> {
    const fromAsset = await this.assetService.getAssetByUniqueName(from);
    const toAsset = await this.assetService.getAssetByUniqueName(to);

    const amount = fromAsset.approxPriceUsd ? 1 / fromAsset.approxPriceUsd : 1;

    const targetAmount = await this.dexService.getTargetAmount(amount, fromAsset, toAsset);

    return Price.create(from, to, Util.round(amount / targetAmount, 8));
  }
}
