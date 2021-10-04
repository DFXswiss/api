import { Injectable } from '@nestjs/common';
import { HttpService } from './http.service';

@Injectable()
export class ConversionService {
  constructor(private http: HttpService) {}

  public round(amount: number, decimals: number): number {
    return Math.round(amount * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  public async convertFiatCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date = new Date(),
  ): Promise<number> {
    const rate = await this.getRate(fromCurrency, toCurrency, date);
    return this.round(amount * rate, 2);
  }

  public async getRate(fromCurrency: string, toCurrency: string, date: Date): Promise<number> {
    const baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';
    const dateString = this.isToday(date) ? 'latest' : date.toISOString().split('T')[0];
    const url = `${baseUrl}/${dateString}/currencies/${fromCurrency.toLowerCase()}/${toCurrency.toLowerCase()}.json`;

    const result = await this.callApi<{[currency: string]: number}>(url);
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
    return this.http.get<T>(url);
  }
}
