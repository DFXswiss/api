import { Injectable } from '@nestjs/common';
import { HttpService } from 'src/shared/services/http.service';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class CurrencyService extends PricingProvider {
  private readonly baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';

  constructor(private readonly http: HttpService) {
    super();
  }

  async getPrice(from: string, to: string): Promise<Price> {
    return this.fetchPrice(from, to);
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
