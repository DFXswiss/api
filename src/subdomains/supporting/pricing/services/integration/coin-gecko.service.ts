import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { Config, GetConfig } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { AssetPricingMetadata } from '../../domain/entities/asset-pricing-metadata.entity';
import { Price } from '../../domain/entities/price';
import { MetadataNotFoundException } from '../../domain/exceptions/metadata-not-found.exception';
import { AssetPricingMetadataRepository } from '../../repositories/asset-pricing-metadata.repository';

@Injectable()
export class CoinGeckoService implements OnModuleInit {
  private readonly logger = new DfxLogger(CoinGeckoService);

  private readonly client: CoinGeckoClient;
  private readonly priceCache: AsyncCache<Price>;
  private usd: Fiat;

  private metaDataCache?: AssetPricingMetadata[];

  constructor(
    private readonly assetPricingMetadataRepo: AssetPricingMetadataRepository,
    private readonly fiatService: FiatService,
  ) {
    this.client = new CoinGeckoClient({ autoRetry: false }, GetConfig().transaction.pricing.coinGeckoApiKey);
    this.priceCache = new AsyncCache(Config.transaction.pricing.refreshRate * 60);
  }

  onModuleInit() {
    void this.fiatService.getFiatByName('USD').then((usd) => (this.usd = usd));
  }

  async getFiatPrice(from: Fiat, to: Fiat): Promise<Price> {
    const fromPrice = await this.getPriceWithId('USDT', 'tether', from.name);
    const toPrice = await this.getPriceWithId('USDT', 'tether', to.name);

    return Price.join(fromPrice.invert(), toPrice);
  }

  async toFiat(asset: Asset, fiat: Fiat): Promise<Price> {
    const { name, coinGeckoId } = await this.getAssetInfo(asset);
    return this.getPriceWithId(name, coinGeckoId, fiat.name);
  }

  async fromFiat(fiat: Fiat, asset: Asset): Promise<Price> {
    const price = await this.toFiat(asset, fiat);
    return price.invert();
  }

  async getCryptoPrice(from: Asset, to: Asset): Promise<Price> {
    const fromPrice = await this.toFiat(from, this.usd);
    const toPrice = await this.fromFiat(this.usd, to);

    return Price.join(fromPrice, toPrice);
  }

  async getPriceAt(asset: Asset, fiat: Fiat, date: Date): Promise<Price> {
    return this.getAvgPrice(asset, fiat, date, Util.hoursAfter(1, date));
  }

  async getAvgPrice(asset: Asset, fiat: Fiat, from: Date, to: Date): Promise<Price> {
    const { name, coinGeckoId } = await this.getAssetInfo(asset);

    const result = await this.callApi((c) =>
      c.coinIdMarketChartRange({
        id: coinGeckoId,
        vs_currency: fiat.name,
        from: from.getTime() / 1000,
        to: to.getTime() / 1000,
      }),
    );

    const price = Util.avg(result.prices.map((p) => p[1]));

    return Price.create(name, fiat.name, 1 / price);
  }

  // --- HELPER METHODS --- //
  private async getPriceWithId(crypto: string, id: string, fiat: string): Promise<Price> {
    return this.priceCache.get(`${id}/${fiat}`, () => this.fetchPrice(crypto, id, fiat), true);
  }

  private async fetchPrice(crypto: string, coinGeckoId: string, fiat: string): Promise<Price> {
    try {
      const data = await this.callApi((c) => c.simplePrice({ ids: coinGeckoId, vs_currencies: fiat }));
      const price = data[coinGeckoId.toLowerCase()]?.[fiat.toLowerCase()];
      if (!price) throw new Error('Price not found');

      return Price.create(crypto, fiat, 1 / price);
    } catch (e) {
      this.logger.error(`Failed to get price for ${crypto} -> ${fiat}:`, e);
      throw new ServiceUnavailableException(`Failed to get price`);
    }
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
