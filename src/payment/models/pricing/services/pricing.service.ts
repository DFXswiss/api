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
  FIAT_TO_BTC = 'ToBTC',
  ALTCOIN_TO_BTC = 'ToBTC',
  FIAT_TO_ALTCOIN = 'ToAltcoin',
  ALTCOIN_TO_ALTCOIN = 'ToAltcoin',
  BTC_TO_ALTCOIN = 'ToAltcoin',
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

    if (Object.values(Fiat).includes(from as unknown as Fiat) && to === 'BTC') return PricingPathAlias.FIAT_TO_BTC;
    if (!Object.values(Fiat).includes(from as unknown as Fiat) && to === 'BTC') return PricingPathAlias.ALTCOIN_TO_BTC;

    if (
      Object.values(Fiat).includes(from as unknown as Fiat) &&
      Object.values(Altcoin).includes(to as unknown as Altcoin)
    ) {
      return PricingPathAlias.FIAT_TO_ALTCOIN;
    }

    if (
      !Object.values(Fiat).includes(from as unknown as Fiat) &&
      Object.values(Altcoin).includes(to as unknown as Altcoin)
    ) {
      return PricingPathAlias.ALTCOIN_TO_ALTCOIN;
    }

    if (from === 'BTC' && Object.values(Altcoin).includes(to as unknown as Altcoin)) {
      return PricingPathAlias.BTC_TO_ALTCOIN;
    }

    if (from === 'USD' && [USDStableCoin.USDC, USDStableCoin.USDT].includes(to as unknown as USDStableCoin)) {
      return PricingPathAlias.MATCHING_FIAT_TO_USD_STABLE_COIN;
    }

    if (
      Object.values(Fiat).includes(from as unknown as Fiat) &&
      Object.values(USDStableCoin).includes(to as unknown as USDStableCoin)
    ) {
      return PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN;
    }

    throw new Error('No matching pricing path found');
  }
}
