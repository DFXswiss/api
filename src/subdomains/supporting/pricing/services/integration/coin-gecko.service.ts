import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class CoinGeckoService extends PricingProvider implements OnModuleInit {
  private readonly logger = new DfxLogger(CoinGeckoService);

  private readonly client: CoinGeckoClient;
  private currencies: string[];

  constructor() {
    super();

    this.client = new CoinGeckoClient({ autoRetry: false }, GetConfig().coinGecko.apiKey);
  }

  onModuleInit() {
    void this.client.simpleSupportedCurrencies().then((cs) => (this.currencies = cs));
  }

  async getPrice(from: string, to: string): Promise<Price> {
    const fromCurrency = this.getCurrency(from);
    const toCurrency = this.getCurrency(to);

    if (fromCurrency && toCurrency) {
      const [priceFrom, priceTo] = await Promise.all([
        this.fetchPrice('tether', fromCurrency),
        this.fetchPrice('tether', toCurrency),
      ]);
      return Price.join(priceFrom.invert(), priceTo);
    } else if (fromCurrency) {
      const price = await this.fetchPrice(to, fromCurrency);
      return price.invert();
    } else if (toCurrency) {
      return this.fetchPrice(from, toCurrency);
    } else {
      const [priceFrom, priceTo] = await Promise.all([this.fetchPrice(from, 'usd'), this.fetchPrice(to, 'usd')]);
      return Price.join(priceFrom, priceTo.invert());
    }
  }

  // --- HELPER METHODS --- //

  private async fetchPrice(token: string, currency: string): Promise<Price> {
    try {
      const data = await this.client.simplePrice({ ids: token, vs_currencies: currency });
      const price = data[token]?.[currency];
      if (!price) throw new Error('Price not found');

      return Price.create(token, currency, 1 / price);
    } catch (e) {
      this.logger.error(`Failed to get price for ${token} -> ${currency}:`, e);
      throw new ServiceUnavailableException(`Failed to get price`);
    }
  }

  private getCurrency(token: string): string | undefined {
    return this.currencies.find((c) => c === token.toLowerCase());
  }
}
