import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { CoinGeckoClient } from 'coingecko-api-v3';
import { GetConfig } from 'src/config/config';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { LoggerFactory } from 'src/logger/logger.factory';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class CoinGeckoService extends PricingProvider implements OnModuleInit {
  private readonly logger: DfxLogger;
  private readonly client: CoinGeckoClient;
  private currencies: string[];

  constructor(readonly loggerFactory: LoggerFactory) {
    super();

    this.client = new CoinGeckoClient({ autoRetry: false }, GetConfig().coinGecko.apiKey);
    this.logger = loggerFactory.create(CoinGeckoService);
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
}
