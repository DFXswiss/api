import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

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
export class FixerService extends PricingProvider {
  constructor(private http: HttpService) {
    super();
  }

  async getPrice(from: string, to: string): Promise<Price> {
    return this.fetchPrice(from, to);
  }

  private async fetchPrice(from: string, to: string): Promise<Price> {
    // currency pair inverted
    const response = await this.http.get<FixerResponse>(`${Config.fixer.baseUrl}/latest?base=${to}&symbols=${from}`, {
      headers: { apikey: Config.fixer.apiKey },
    });

    if (!response.success) throw new Error(`Could not get price ${from} -> ${to} from Fixer`);

    const targetPrice = response.rates[from];

    if (targetPrice === undefined) throw new Error(`Could not find price ${from} -> ${to} on Fixer`);

    return Price.create(from, to, targetPrice);
  }
}
