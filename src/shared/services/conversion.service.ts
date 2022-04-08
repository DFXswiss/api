import { Injectable } from '@nestjs/common';
import { Util } from '../util';
import { HttpService } from './http.service';

@Injectable()
export class ConversionService {
  private readonly fiatUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';

  constructor(private readonly http: HttpService) {}

  public async convertFiat(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date = new Date(),
  ): Promise<number> {
    const rate = await this.getFiatRate(fromCurrency, toCurrency, date);
    return Util.round(amount * rate, 2);
  }

  async getFiatRate(fromCurrency: string, toCurrency: string, date: Date = new Date()): Promise<number> {
    const dateString = this.isToday(date) ? 'latest' : date.toISOString().split('T')[0];
    const url = `${
      this.fiatUrl
    }/${dateString}/currencies/${fromCurrency.toLowerCase()}/${toCurrency.toLowerCase()}.json`;

    const result = await this.callApi<{ [currency: string]: number }>(url);
    return result[toCurrency.toLowerCase()];
  }

  private isToday(date: Date): boolean {
    const today = new Date();
    return (
      date.getUTCDate() == today.getUTCDate() &&
      date.getUTCMonth() == today.getUTCMonth() &&
      date.getUTCFullYear() == today.getUTCFullYear()
    );
  }

  private async callApi<T>(url: string): Promise<T> {
    return this.http.get<T>(url, { tryCount: 3 });
  }
}
