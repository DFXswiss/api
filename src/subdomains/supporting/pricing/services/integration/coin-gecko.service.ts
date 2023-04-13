import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import CoinGeckoClient = require('coingecko-api');
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';
import { AssetPricingMetadata } from '../../domain/entities/asset-pricing-metadata.entity';
import { Price } from '../../domain/entities/price';
import { Fiat } from '../../domain/enums';
import { MetadataNotFoundException } from '../../domain/exceptions/metadata-not-found.exception';
import { AssetPricingMetadataRepository } from '../../repositories/asset-pricing-metadata.repository';
import { Config } from 'src/config/config';

@Injectable()
export class CoinGeckoService {
  private readonly client: CoinGeckoClient;

  private metaDataCache?: AssetPricingMetadata[];
  private priceCache = new Map<string, { updated: Date; price: Price }>();

  constructor(private readonly assetPricingMetadataRepo: AssetPricingMetadataRepository) {
    this.client = new CoinGeckoClient();
  }

  async getFiatPrice(from: Fiat, to: Fiat): Promise<Price> {
    const fromPrice = await this.getPriceWithId('USDT', 'tether', from);
    const toPrice = await this.getPriceWithId('USDT', 'tether', to);

    return Price.join(fromPrice.invert(), toPrice);
  }

  async getPrice(asset: Asset, fiat: Fiat): Promise<Price> {
    const { name, coinGeckoId } = await this.getAssetInfo(asset);
    return this.getPriceWithId(name, coinGeckoId, fiat);
  }

  async getPriceAt(asset: Asset, fiat: Fiat, date: Date): Promise<Price> {
    return this.getAvgPrice(asset, fiat, date, Util.hoursAfter(1, date));
  }

  async getAvgPrice(asset: Asset, fiat: Fiat, from: Date, to: Date): Promise<Price> {
    const { name, coinGeckoId } = await this.getAssetInfo(asset);

    const { data } = await this.callApi((c) =>
      c.coins.fetchMarketChartRange(coinGeckoId, {
        vs_currency: fiat,
        from: from.getTime() / 1000,
        to: to.getTime() / 1000,
      }),
    );

    const price = Util.avg(data.prices.map((p) => p[1]));

    return Price.create(name, fiat, 1 / price);
  }

  // --- HELPER METHODS --- //
  private async getPriceWithId(name: string, id: string, fiat: Fiat): Promise<Price> {
    const identifier = `${id}/${fiat}`;

    if (!(this.priceCache.get(identifier)?.updated > Util.minutesBefore(Config.transaction.pricing.refreshRate))) {
      const price = await this.fetchPrice(name, id, fiat);
      this.priceCache.set(identifier, { updated: new Date(), price });
    }

    return this.priceCache.get(identifier).price;
  }

  private async fetchPrice(name: string, coinGeckoId: string, fiat: Fiat): Promise<Price> {
    const { data } = await this.callApi((c) => c.simple.price({ ids: coinGeckoId, vs_currencies: fiat }));

    const price = data[coinGeckoId.toLowerCase()]?.[fiat.toLowerCase()];
    if (!price) throw new ServiceUnavailableException(`Failed to get price for ${name} -> ${fiat}`);

    return Price.create(name, fiat, 1 / price);
  }

  private async getAssetInfo(asset: Asset): Promise<{ name: string; coinGeckoId: string }> {
    const metadata = (this.metaDataCache ??= await this.assetPricingMetadataRepo.find({ relations: ['asset'] }));

    const assetPricingMetadata = metadata.find((m) => m.asset.id === asset.id);
    if (!assetPricingMetadata) throw new MetadataNotFoundException(`No metadata found for asset ${asset.id}`);

    return { name: asset.name, coinGeckoId: assetPricingMetadata.fiatPriceProviderAssetId };
  }

  private callApi<T>(call: (c: CoinGeckoClient) => Promise<T>): Promise<T> {
    return call(this.client);
  }
}
