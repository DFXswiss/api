import { Injectable } from '@nestjs/common';
import { ConversionService } from 'src/shared/services/conversion.service';
import { PriceProvider } from '../../pricing/interfaces';
import { Price } from '../dto/price.dto';

@Injectable()
export class CurrencyService implements PriceProvider {
  readonly name: string;

  constructor(private readonly conversionService: ConversionService) {
    this.name = 'CurrencyService';
  }

  async getPrice(from: string, to: string): Promise<Price> {
    const targetPrice = await this.conversionService.convertFiat(1, from, to);

    if (targetPrice === undefined) {
      throw new Error(`Could not find target price on CurrencyService. From: ${from}, to: ${to}`);
    }

    const price = new Price();

    price.source = from;
    price.target = to;
    price.price = targetPrice;

    return price;
  }
}
