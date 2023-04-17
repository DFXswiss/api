import { Injectable } from '@nestjs/common';
import { PricingProvider } from '../../domain/interfaces';
import { Price } from '../../domain/entities/price';
import { HttpService } from 'src/shared/services/http.service';

@Injectable()
export class CurrencyService implements PricingProvider {
  private readonly baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';

  readonly name: string;

  constructor(private readonly http: HttpService) {
    this.name = 'CurrencyService';
  }

  async getPrice(from: string, to: string): Promise<Price> {
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
