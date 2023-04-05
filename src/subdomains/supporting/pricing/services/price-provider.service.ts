import { Injectable, NotImplementedException } from '@nestjs/common';
import { CoinGeckoService } from './integration/coin-gecko.service';
import { PriceProviderDeFiChainService } from './integration/price-provider-defichain.service';
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
  private readonly chainsWithSwapPricing = [Blockchain.DEFICHAIN];
  private readonly refAssetMap = new Map<Blockchain, Asset>();

  constructor(
    private readonly assetService: AssetService,
    private readonly coinGeckoService: CoinGeckoService,
    private readonly deFiChainService: PriceProviderDeFiChainService,
  ) {}

  async getPrice(from: Asset, to: Asset): Promise<Price> {
    // get swap price, if available
    if (from.blockchain === to.blockchain && this.chainsWithSwapPricing.includes(from.blockchain))
      return this.getSwapPrice(from, to);

    // get exchange price via USD
    const toRef = await this.getFiatPrice(from, Fiat.USD);
    const fromRef = await this.getFiatPrice(to, Fiat.USD);

    return Price.join(toRef, fromRef.invert());
  }

  async getFiatPrice(asset: Asset, fiat: Fiat): Promise<Price> {
    try {
      return await this.coinGeckoService.getPrice(asset, fiat);
    } catch (e) {
      if (!(e instanceof MetadataNotFoundException)) throw e;
    }

    // metadata not found -> use reference asset
    const refAsset = await this.getFiatReferenceAssetFor(asset.blockchain);

    const exchangePrice = await this.getSwapPrice(asset, refAsset);
    const fiatPrice = await this.coinGeckoService.getPrice(refAsset, fiat);

    return Price.join(exchangePrice, fiatPrice);
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

  async getSwapPrice(from: Asset, to: Asset): Promise<Price> {
    if (from.blockchain !== to.blockchain) throw new Error('Inter blockchain swap prices not possible');

    if (!this.chainsWithSwapPricing.includes(from.blockchain))
      throw new NotImplementedException(`Swap pricing is not implemented for ${from.blockchain}`);

    return this.deFiChainService.getPrice(from, to);
  }
}
