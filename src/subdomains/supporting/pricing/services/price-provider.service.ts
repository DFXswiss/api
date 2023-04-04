import { Injectable, NotImplementedException } from '@nestjs/common';
import { CoinGeckoService } from './coin-gecko.service';
import { PricingDeFiChainService } from './pricing-defichain.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Price } from '../domain/entities/price';
import { Fiat } from '../domain/enums';
import { MetadataNotFoundException } from '../domain/exceptions/metadata-not-found.exception';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

/**
 * Price provider service - use this service for indicative and fiat prices
 */
@Injectable()
export class PriceProviderService {
  private readonly refAssetMap = new Map<Blockchain, Asset>();

  constructor(
    private readonly assetService: AssetService,
    private readonly coinGeckoService: CoinGeckoService,
    private readonly deFiChainService: PricingDeFiChainService,
  ) {}

  async getFiatPrice(asset: Asset, fiat: Fiat): Promise<Price> {
    try {
      return await this.coinGeckoService.getPrice(asset, fiat);
    } catch (e) {
      if (!(e instanceof MetadataNotFoundException)) throw e;
    }

    // metadata not found -> use reference asset
    const refAsset = await this.getFiatReferenceAssetFor(asset.blockchain);

    const exchangePrice = await this.getExchangePrice(asset, refAsset);
    const fiatPrice = await this.coinGeckoService.getPrice(refAsset, fiat);

    return Price.join(exchangePrice, fiatPrice);
  }

  async getExchangePrice(from: Asset, to: Asset): Promise<Price> {
    if (from.blockchain !== to.blockchain)
      throw new NotImplementedException('Inter blockchain exchange prices not implemented');

    if (from.blockchain !== Blockchain.DEFICHAIN)
      throw new NotImplementedException(`Pricing is not implemented for ${from.blockchain}`);

    return this.deFiChainService.getPrice(from, to);
  }

  // --- HELPER METHODS --- //
  private async getFiatReferenceAssetFor(blockchain: Blockchain): Promise<Asset> {
    if (!this.refAssetMap.has(blockchain)) {
      const refAsset = await this.assetService.getAssetByQuery({
        dexName: 'USDT',
        type: AssetType.TOKEN,
        blockchain: blockchain,
      });
      this.refAssetMap.set(blockchain, refAsset);
    }

    return this.refAssetMap.get(blockchain);
  }
}
