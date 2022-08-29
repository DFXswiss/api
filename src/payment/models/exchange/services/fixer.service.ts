import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { PriceProvider } from '../../pricing/interfaces';
import { Price } from '../dto/price.dto';

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
    const response = await this.http.get<FixerResponse>(
      `${Config.fixer.baseUrl}/latest?access_key=${Config.fixer.apiKey}&base=${from}&symbols=${to}`,
    );

    if (!response.success) throw new Error(`Could not get price from Fixer. From: ${from}, to: ${to}`);

    const targetPrice = response.rates[to];

    if (targetPrice === undefined) throw new Error(`Could not find target price on Fixer. From: ${from}, to: ${to}`);

    const price = new Price();

    price.source = from;
    price.target = to;
    price.price = targetPrice;

    return price;
  }
}
