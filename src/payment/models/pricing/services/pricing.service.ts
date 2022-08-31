import { Injectable } from '@nestjs/common';
import { BinanceService } from '../../exchange/services/binance.service';
import { BitpandaService } from '../../exchange/services/bitpanda.service';
import { BitstampService } from '../../exchange/services/bitstamp.service';
import { FixerService } from '../../exchange/services/fixer.service';
import { KrakenService } from '../../exchange/services/kraken.service';
import { Altcoin, USDStableCoin, Fiat } from '../enums';
import { PriceRequest, PriceResult } from '../interfaces';
import { PricePath } from '../utils/price-path';
import { PriceStep } from '../utils/price-step';

export enum PricingPathAlias {
  MATCHING_ASSETS = 'MatchingAssets',
  FIAT_TO_BTC = 'FiatToBTC',
  ALTCOIN_TO_BTC = 'AltcoinToBTC',
  FIAT_TO_ALTCOIN = 'FiatToAltcoin',
  ALTCOIN_TO_ALTCOIN = 'AltcoinToAltcoin',
  BTC_TO_ALTCOIN = 'BTCToAltcoin',
  MATCHING_FIAT_TO_USD_STABLE_COIN = 'MatchingFiatToUSDStableCoin',
  NON_MATCHING_FIAT_TO_USD_STABLE_COIN = 'NonMatchingFiatToUSDStableCoin',
}

@Injectable()
export class PricingService {
  private readonly pricingPaths: Map<PricingPathAlias, PricePath> = new Map();

  constructor(
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
    private readonly bitpandaService: BitpandaService,
    private readonly fixerService: FixerService,
  ) {
    this.addPath(
      new PricePath(PricingPathAlias.MATCHING_ASSETS, [
        new PriceStep({
          fixedPrice: 1,
        }),
      ]),
    );

    // everywhere FIAT is kraken, Altcoin - Binance
    // Fiat to BTC only and NOT Altcoin to BTC
    this.addPath(
      new PricePath(PricingPathAlias.FIAT_TO_BTC, [
        new PriceStep({
          to: 'BTC',
          providers: {
            primary: [this.krakenService],
            reference: [this.binanceService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    // BNB to BTC
    this.addPath(
      new PricePath(PricingPathAlias.ALTCOIN_TO_BTC, [
        new PriceStep({
          to: 'BTC',
          providers: {
            primary: [this.binanceService],
            reference: [this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.FIAT_TO_ALTCOIN, [
        new PriceStep({
          to: 'BTC',
          providers: {
            primary: [this.krakenService],
            reference: [this.binanceService, this.bitstampService, this.bitpandaService],
          },
        }),
        new PriceStep({
          from: 'BTC',
          providers: {
            primary: [this.binanceService],
            reference: [this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.ALTCOIN_TO_ALTCOIN, [
        new PriceStep({
          to: 'BTC',
          providers: {
            primary: [this.binanceService],
            reference: [this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
        new PriceStep({
          from: 'BTC',
          providers: {
            primary: [this.binanceService],
            reference: [this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.BTC_TO_ALTCOIN, [
        new PriceStep({
          from: 'BTC',
          providers: {
            primary: [this.binanceService],
            reference: [this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.MATCHING_FIAT_TO_USD_STABLE_COIN, [
        new PriceStep({
          fixedPrice: 1,
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN, [
        new PriceStep({
          referenceTo: 'USD',
          providers: {
            primary: [this.krakenService],
            reference: [this.fixerService],
          },
        }),
      ]),
    );

    // TODO - think about automatic reverse conversion.... somehow
  }

  //*** PUBLIC API ***//

  async getPrice(request: PriceRequest): Promise<PriceResult> {
    const path = this.getPath(request);

    return path.execute(request);
  }

  //*** HELPER METHODS ***//

  private addPath(path: PricePath): void {
    this.pricingPaths.set(path.alias, path);
  }

  private getPath(request: PriceRequest): PricePath {
    const alias = this.getAlias(request);

    return this.pricingPaths.get(alias);
  }

  private getAlias(request: PriceRequest): PricingPathAlias {
    const { from, to } = request;

    if (from === to) return PricingPathAlias.MATCHING_ASSETS;

    if (this.isFiat(from) && to === 'BTC') return PricingPathAlias.FIAT_TO_BTC;

    if (!this.isFiat(from) && to === 'BTC') return PricingPathAlias.ALTCOIN_TO_BTC;

    if (this.isFiat(from) && this.isAltcoin(to)) return PricingPathAlias.FIAT_TO_ALTCOIN;

    if (!this.isFiat(from) && this.isAltcoin(to)) return PricingPathAlias.ALTCOIN_TO_ALTCOIN;

    if (from === 'BTC' && this.isAltcoin(to)) return PricingPathAlias.BTC_TO_ALTCOIN;

    if (from === 'USD' && this.isUSDStablecoin(to)) return PricingPathAlias.MATCHING_FIAT_TO_USD_STABLE_COIN;

    if (this.isFiat(from) && this.isUSDStablecoin(to)) return PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN;

    throw new Error('No matching pricing path found');
  }

  private isFiat(asset: string): boolean {
    return Object.values(Fiat).includes(asset as unknown as Fiat);
  }

  private isAltcoin(asset: string): boolean {
    return Object.values(Altcoin).includes(asset as unknown as Altcoin);
  }

  private isUSDStablecoin(asset: string): boolean {
    return Object.values(USDStableCoin).includes(asset as unknown as USDStableCoin);
  }
}
