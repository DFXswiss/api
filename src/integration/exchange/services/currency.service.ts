import { Injectable } from '@nestjs/common';
import { ConversionService } from 'src/integration/exchange/services/conversion.service';
import { PriceProvider } from 'src/subdomains/supporting/pricing/domain/interfaces';
import { Price } from '../../../subdomains/supporting/pricing/domain/entities/price';

@Injectable()
export class CurrencyService implements PriceProvider {
  readonly name: string;

  constructor(private readonly conversionService: ConversionService) {
    this.name = 'CurrencyService';
  }

  async getPrice(from: string, to: string): Promise<Price> {
    // currency pair have to be inverted for conversion service.
    const targetPrice = await this.conversionService.getFiatRate(to, from);

    if (targetPrice === undefined) {
      throw new Error(`Could not find target price on CurrencyService. From: ${from}, to: ${to}`);
    }

    return Price.create(from, to, targetPrice);
  }
}
