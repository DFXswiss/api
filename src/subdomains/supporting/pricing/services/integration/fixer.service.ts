import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { PricingProvider } from 'src/subdomains/supporting/pricing/domain/interfaces';
import { Price } from '../../domain/entities/price';
import { AsyncCache } from 'src/shared/utils/async-cache';

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
export class FixerService implements PricingProvider {
  readonly name: string;

  private readonly priceCache: AsyncCache<Price>;

  constructor(private http: HttpService) {
    this.name = 'Fixer';
    this.priceCache = new AsyncCache(Config.transaction.pricing.refreshRate * 60);
  }

  async getPrice(from: string, to: string): Promise<Price> {
    return this.priceCache.get(`${from}/${to}`, () => this.fetchPrice(from, to));
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
