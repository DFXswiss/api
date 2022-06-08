import { Injectable } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { Price } from './dto/price.dto';
import { KrakenService } from './kraken.service';

@Injectable()
export class ExchangeUtilityService {
  constructor(private readonly krakenService: KrakenService, private readonly binanceService: BinanceService) {}

  async getMatchingPrice(fromCurrency: string, toCurrency: string, matchThreshold = 0.02): Promise<Price> {
    const krakenPrice = await this.krakenService.getPrice(fromCurrency, toCurrency);
    const binancePrice = await this.binanceService.getPrice(fromCurrency, toCurrency);

    const { price: krakenPriceValue } = krakenPrice;
    const { price: binancePriceValue } = binancePrice;

    if (Math.abs(binancePriceValue - krakenPriceValue) / krakenPriceValue > matchThreshold)
      throw new Error(
        `${fromCurrency} to ${toCurrency} price mismatch (kraken: ${krakenPriceValue}, binance: ${binancePriceValue})`,
      );

    return krakenPrice;
  }
}
