import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { PricingProvider } from 'src/subdomains/supporting/pricing/domain/interfaces';
import { Price } from '../../domain/entities/price';
import { Util } from 'src/shared/utils/util';

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
  private priceCache = new Map<string, { updated: Date; price: Price }>();

  readonly name: string;

  constructor(private http: HttpService) {
    this.name = 'Fixer';
  }

  async getPrice(from: string, to: string): Promise<Price> {
    const identifier = `${from}/${to}`;

    if (!(this.priceCache.get(identifier)?.updated > Util.minutesBefore(Config.transaction.pricing.refreshRate))) {
      const price = await this.fetchPrice(from, to);
      this.priceCache.set(identifier, { updated: new Date(), price });
    }

    return this.priceCache.get(identifier).price;
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
