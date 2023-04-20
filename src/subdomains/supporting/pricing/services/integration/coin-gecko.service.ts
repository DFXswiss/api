import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import CoinGeckoClient = require('coingecko-api');
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { AssetPricingMetadata } from '../../domain/entities/asset-pricing-metadata.entity';
import { Price } from '../../domain/entities/price';
import { MetadataNotFoundException } from '../../domain/exceptions/metadata-not-found.exception';
import { AssetPricingMetadataRepository } from '../../repositories/asset-pricing-metadata.repository';
import { Config } from 'src/config/config';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';

@Injectable()
export class CoinGeckoService {
  private readonly client: CoinGeckoClient;
  private readonly priceCache: AsyncCache<Price>;

  private metaDataCache?: AssetPricingMetadata[];

  constructor(private readonly assetPricingMetadataRepo: AssetPricingMetadataRepository) {
    this.client = new CoinGeckoClient();
    this.priceCache = new AsyncCache(Config.transaction.pricing.refreshRate * 60);
  }

  async getFiatPrice(from: Fiat, to: Fiat): Promise<Price> {
    const fromPrice = await this.getPriceWithId('USDT', 'tether', from);
    const toPrice = await this.getPriceWithId('USDT', 'tether', to);

    return Price.join(fromPrice.invert(), toPrice);
  }

  async toFiat(asset: Asset, fiat: Fiat): Promise<Price> {
    const { name, coinGeckoId } = await this.getAssetInfo(asset);
    return this.getPriceWithId(name, coinGeckoId, fiat);
  }

  async fromFiat(fiat: Fiat, asset: Asset): Promise<Price> {
    const price = await this.toFiat(asset, fiat);
    return price.invert();
  }

  async getPriceAt(asset: Asset, fiat: Fiat, date: Date): Promise<Price> {
    return this.getAvgPrice(asset, fiat, date, Util.hoursAfter(1, date));
  }

  async getAvgPrice(asset: Asset, fiat: Fiat, from: Date, to: Date): Promise<Price> {
    const { name, coinGeckoId } = await this.getAssetInfo(asset);

    const { data } = await this.callApi((c) =>
      c.coins.fetchMarketChartRange(coinGeckoId, {
        vs_currency: fiat.name,
        from: from.getTime() / 1000,
        to: to.getTime() / 1000,
      }),
    );

    const price = Util.avg(data.prices.map((p) => p[1]));

    return Price.create(name, fiat.name, 1 / price);
  }

  // --- HELPER METHODS --- //
  private async getPriceWithId(name: string, id: string, fiat: Fiat): Promise<Price> {
    return this.priceCache.get(`${id}/${fiat.name}`, () => this.fetchPrice(name, id, fiat));
  }

  private async fetchPrice(name: string, coinGeckoId: string, fiat: Fiat): Promise<Price> {
    const { data } = await this.callApi((c) => c.simple.price({ ids: coinGeckoId, vs_currencies: fiat.name }));

    const price = data[coinGeckoId.toLowerCase()]?.[fiat.name.toLowerCase()];
    if (!price) throw new ServiceUnavailableException(`Failed to get price for ${name} -> ${fiat.name}`);

    return Price.create(name, fiat.name, 1 / price);
  }

  private async getAssetInfo(asset: Asset): Promise<{ name: string; coinGeckoId: string }> {
    const metadata = (this.metaDataCache ??= await this.assetPricingMetadataRepo.find({ relations: ['asset'] }));

    const assetPricingMetadata = metadata.find((m) => m.asset.id === asset.id);
    if (!assetPricingMetadata) throw new MetadataNotFoundException(`No metadata found for asset ${asset.id}`);

    return { name: asset.dexName, coinGeckoId: assetPricingMetadata.fiatPriceProviderAssetId };
  }

  private callApi<T>(call: (c: CoinGeckoClient) => Promise<T>): Promise<T> {
    return call(this.client);
  }
}
