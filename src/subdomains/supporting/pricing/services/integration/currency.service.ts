import { Injectable } from '@nestjs/common';
import { PricingProvider } from '../../domain/interfaces';
import { Price } from '../../domain/entities/price';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Config } from 'src/config/config';

@Injectable()
export class CurrencyService implements PricingProvider {
  private readonly baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';
  private readonly priceCache: AsyncCache<Price>;

  readonly name: string;

  constructor(private readonly http: HttpService) {
    this.name = 'CurrencyService';
    this.priceCache = new AsyncCache(Config.transaction.pricing.refreshRate * 60);
  }

  async getPrice(from: string, to: string): Promise<Price> {
    return this.priceCache.get(`${from}/${to}`, () => this.fetchPrice(from, to));
  }

  private async fetchPrice(from: string, to: string): Promise<Price> {
    // currency pair inverted
    const url = `${this.baseUrl}/latest/currencies/${to.toLowerCase()}/${from.toLowerCase()}.json`;

    const { [from.toLowerCase()]: price } = await this.callApi<{ [currency: string]: number }>(url);

    if (price === undefined) {
      throw new Error(`Could not find price ${from} -> ${to} on CurrencyService`);
    }

    return Price.create(from, to, price);
  }

  private async callApi<T>(url: string): Promise<T> {
    return this.http.get<T>(url, { tryCount: 3 });
  }
}
