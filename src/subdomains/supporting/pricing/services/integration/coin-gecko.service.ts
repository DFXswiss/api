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

  async getPrice(from: string, to: string, param: string): Promise<Price> {
    if (param === 'contract') return this.getPriceFromContract(from, to);

    return this.getPriceFromToken(from, to);
  }

  private async getPriceFromContract(contractAddress: string, to: string): Promise<Price> {
    const toCurrency = this.getCurrency(to);

    return this.fetchPriceFromContract(contractAddress, toCurrency);
  }

  private async getPriceFromToken(from: string, to: string): Promise<Price> {
    const fromCurrency = this.getCurrency(from);
    const toCurrency = this.getCurrency(to);

    if (fromCurrency && toCurrency) {
      const [priceFrom, priceTo] = await Promise.all([
        this.fetchPriceFromToken('tether', fromCurrency),
        this.fetchPriceFromToken('tether', toCurrency),
      ]);
      return Price.join(priceFrom.invert(), priceTo);
    } else if (fromCurrency) {
      const price = await this.fetchPriceFromToken(to, fromCurrency);
      return price.invert();
    } else if (toCurrency) {
      return this.fetchPriceFromToken(from, toCurrency);
    } else {
      const [priceFrom, priceTo] = await Promise.all([
        this.fetchPriceFromToken(from, 'usd'),
        this.fetchPriceFromToken(to, 'usd'),
      ]);
      return Price.join(priceFrom, priceTo.invert());
    }
  }

  // --- HELPER METHODS --- //

  private async fetchPriceFromToken(token: string, currency: string): Promise<Price> {
    try {
      const data = await this.client.simplePrice({ ids: token, vs_currencies: currency });
      const price = data[token]?.[currency];
      if (!price) throw new Error('Price not found');

      return Price.create(token, currency, 1 / price);
    } catch (e) {
      this.logger.error(`Failed to get price for token ${token} -> ${currency}:`, e);
      throw new ServiceUnavailableException(`Failed to get price`);
    }
  }

  private async fetchPriceFromContract(contractAddress: string, currency: string): Promise<Price> {
    try {
      const data = await this.client.simpleTokenPrice({
        id: 'ethereum',
        contract_addresses: contractAddress,
        vs_currencies: currency,
      });
      const price = data[contractAddress]?.[currency];
      if (!price) {
        this.logger.info(`No price for contract ${contractAddress} -> ${currency}`);
        return;
      }

      return Price.create(contractAddress, currency, 1 / price);
    } catch (e) {
      this.logger.error(`Failed to get price for contract ${contractAddress} -> ${currency}:`, e);
      throw new ServiceUnavailableException(`Failed to get price`);
    }
  }

  private getCurrency(token: string): string | undefined {
    return this.currencies.find((c) => c === token.toLowerCase());
  }

  async getHistoricalPrice(
    coinId: string,
    date: Date,
    currency: 'usd' | 'eur' | 'chf',
  ): Promise<number | undefined> {
    try {
      const dateStr = this.formatDateForCoinGecko(date);
      const data = await this.client.coinIdHistory({ id: coinId, date: dateStr, localization: false });
      return data.market_data?.current_price?.[currency];
    } catch (e) {
      this.logger.error(`Failed to get historical price for ${coinId} on ${date}:`, e);
      return undefined;
    }
  }

  async getHistoricalPriceByContract(
    platform: string,
    contractAddress: string,
    date: Date,
    currency: 'usd' | 'eur' | 'chf',
  ): Promise<number | undefined> {
    try {
      const dateStr = this.formatDateForCoinGecko(date);
      const apiKey = GetConfig().coinGecko.apiKey;
      const baseUrl = apiKey ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3';
      const historyUrl = `${baseUrl}/coins/${platform}/contract/${contractAddress.toLowerCase()}/history?date=${dateStr}`;

      const headers: Record<string, string> = { accept: 'application/json' };
      if (apiKey) headers['x-cg-pro-api-key'] = apiKey;

      const response = await fetch(historyUrl, { headers });
      if (!response.ok) {
        this.logger.info(`No historical price for contract ${contractAddress} on ${dateStr}: ${response.status}`);
        return undefined;
      }

      const data = await response.json();
      return data.market_data?.current_price?.[currency];
    } catch (e) {
      this.logger.error(`Failed to get historical price for contract ${contractAddress} on ${date}:`, e);
      return undefined;
    }
  }

  private formatDateForCoinGecko(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }
}
