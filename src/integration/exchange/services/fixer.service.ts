import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { PriceProvider } from 'src/subdomains/supporting/pricing/domain/interfaces';
import { Price } from '../../../subdomains/supporting/pricing/domain/entities/price';

interface FixerResponse {
  base: string;
  date: string;
  rates: {
    [key: string]: number;
  };
  success: boolean;
  timestamp: number;
}

@Injectable()
export class FixerService implements PriceProvider {
  readonly name: string;

  constructor(private http: HttpService) {
    this.name = 'Fixer';
  }

  async getPrice(from: string, to: string): Promise<Price> {
    // currency pair have to be inverted.
    const response = await this.http.get<FixerResponse>(`${Config.fixer.baseUrl}/latest?base=${to}&symbols=${from}`, {
      headers: { apikey: Config.fixer.apiKey },
    });

    if (!response.success) throw new Error(`Could not get price from Fixer. From: ${from}, to: ${to}`);

    const targetPrice = response.rates[from];

    if (targetPrice === undefined) throw new Error(`Could not find target price on Fixer. From: ${from}, to: ${to}`);

    return Price.create(from, to, targetPrice);
  }
}
