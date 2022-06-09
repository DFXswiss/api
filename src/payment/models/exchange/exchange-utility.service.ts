import { Injectable } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { BitstampService } from './bitstamp.service';
import { Price } from './dto/price.dto';
import { KrakenService } from './kraken.service';

type PriceSource = string;

@Injectable()
export class ExchangeUtilityService {
  constructor(
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
  ) {}

  async getMatchingPrice(fromCurrency: string, toCurrency: string, matchThreshold = 0.02): Promise<Price> {
    const mainPrice = await this.krakenService.getPrice(fromCurrency, toCurrency);
    const [refPrice, refSource] = await this.getReferencePrice(fromCurrency, toCurrency);

    const { price: _mainPrice } = mainPrice;
    const { price: _refPrice } = refPrice;

    if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold)
      throw new Error(
        `${fromCurrency} to ${toCurrency} price mismatch (kraken: ${_mainPrice}, ${refSource}: ${_refPrice})`,
      );

    return mainPrice;
  }

  private async getReferencePrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceSource]> {
    try {
      return [await this.binanceService.getPrice(fromCurrency, toCurrency), 'binance'];
    } catch {
      console.log(`Could not find reference price at Binance. From ${fromCurrency} to ${toCurrency}`);
    }

    try {
      return [await this.bitstampService.getPrice(fromCurrency, toCurrency), 'bitstamp'];
    } catch {
      console.log(`Could not find reference price at Bitstamp. From ${fromCurrency} to ${toCurrency}`);
    }

    throw new Error(
      `Could not find reference price at both Binance and Bitstamp. From ${fromCurrency} to ${toCurrency}`,
    );
  }
}
