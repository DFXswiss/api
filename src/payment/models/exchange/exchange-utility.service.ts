import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { BinanceService } from './binance.service';
import { BitpandaService } from './bitpanda.service';
import { BitstampService } from './bitstamp.service';
import { Price } from './dto/price.dto';
import { PriceMismatchException } from './exceptions/price-mismatch.exception';
import { KrakenService } from './kraken.service';

type PriceSource = string;

@Injectable()
export class ExchangeUtilityService {
  constructor(
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
    private readonly bitpandaService: BitpandaService,
    private readonly mailService: MailService,
  ) {}

  async getMatchingPrice(fromCurrency: string, toCurrency: string, matchThreshold = 0.005): Promise<Price> {
    const mainPrice = await this.krakenService.getPrice(fromCurrency, toCurrency);

    try {
      const [refPrice, refSource] = await this.getReferencePrice(fromCurrency, toCurrency);

      const { price: _mainPrice } = mainPrice;
      const { price: _refPrice } = refPrice;

      if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold)
        throw new PriceMismatchException(
          `${fromCurrency} to ${toCurrency} price mismatch (Kraken: ${_mainPrice}, ${refSource}: ${_refPrice})`,
        );
    } catch (e) {
      if (e instanceof PriceMismatchException) {
        await this.mailService.sendErrorMail('Exchange Price Mismatch', [e.message]);
        throw e;
      }

      console.warn(
        `Proceeding without reference check from Binance, Bitstamp and Bitpanda. From ${fromCurrency} to ${toCurrency}`,
      );
    }

    return mainPrice;
  }

  private async getReferencePrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceSource]> {
    const referenceExchanges = [this.binanceService, this.bitstampService, this.bitpandaService];

    for (const exchange of referenceExchanges) {
      try {
        return [await exchange.getPrice(fromCurrency, toCurrency), exchange.name];
      } catch {}
    }

    throw new Error(
      `Could not find reference price at Binance, Bitstamp and Bitpanda. From ${fromCurrency} to ${toCurrency}`,
    );
  }
}
