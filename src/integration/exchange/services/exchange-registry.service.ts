import { BadRequestException, Injectable } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { BitpandaService } from './bitpanda.service';
import { BitstampService } from './bitstamp.service';
import { ExchangeService } from './exchange.service';
import { KrakenService } from './kraken.service';
import { KucoinService } from './kucoin.service';

@Injectable()
export class ExchangeRegistryService {
  constructor(
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
    private readonly bitpandaService: BitpandaService,
    private readonly kucoinService: KucoinService,
  ) {}

  getExchange(exchange: string): ExchangeService {
    switch (exchange) {
      case 'kraken':
        return this.krakenService;
      case 'binance':
        return this.binanceService;
      case 'bitstamp':
        return this.bitstampService;
      case 'bitpanda':
        return this.bitpandaService;
      case 'kucoin':
        return this.kucoinService;
      default:
        throw new BadRequestException(`No service for exchange '${exchange}'`);
    }
  }
}
