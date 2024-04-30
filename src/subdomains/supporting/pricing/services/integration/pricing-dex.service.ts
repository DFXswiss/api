import { Injectable } from '@nestjs/common';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DexService } from '../../../dex/services/dex.service';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from '../../domain/interfaces';

@Injectable()
export class PricingDexService implements PricingProvider {
  constructor(private dexService: DexService, private assetService: AssetService) {}

  async getPrice(from: string, to: string, param?: string): Promise<Price> {
    const fromAsset = await this.assetService.getAssetByUniqueName(from);
    const toAsset = await this.assetService.getAssetByUniqueName(to);

    const price = await this.dexService.calculatePrice(fromAsset, toAsset, param && +param);
    return Price.create(from, to, price);
  }
}
