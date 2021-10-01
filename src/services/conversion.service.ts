import { Injectable } from '@nestjs/common';
import { HttpService } from './http.service';

@Injectable()
export class ConversionService {
  constructor(private http: HttpService) {}

  public async convertFiatCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date,
  ): Promise<number> {
    const baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';
    const url = this.isToday(date)
      ? `${baseUrl}/latest/currencies/${fromCurrency.toLowerCase()}/${toCurrency.toLowerCase()}.json`
      : `${baseUrl}/${
          date.toISOString().split('T')[0]
        }/currencies/${fromCurrency.toLowerCase()}/${toCurrency.toLowerCase()}.json`;

    const result = await this.callApi<any>(url);
    return Math.round(amount * result[toCurrency.toLowerCase()] * Math.pow(10, 2)) / Math.pow(10, 2);
  }

  public async getRate(fromCurrency: string, toCurrency: string, date: Date): Promise<number> {
    const baseUrl = 'https://cdn.jsdelivr.net/gh/fawazahmed0/currency-api@1';
    const url = this.isToday(date)
      ? `${baseUrl}/latest/currencies/${fromCurrency.toLowerCase()}/${toCurrency.toLowerCase()}.json`
      : `${baseUrl}/${
          date.toISOString().split('T')[0]
        }/currencies/${fromCurrency.toLowerCase()}/${toCurrency.toLowerCase()}.json`;

    const result = await this.callApi<any>(url);
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
    return this.http.request<T>({
      url: `${url}`,
      method: 'GET',
    });
  }
}
