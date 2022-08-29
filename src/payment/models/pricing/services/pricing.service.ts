import { Injectable } from '@nestjs/common';
import { BinanceService } from '../../exchange/services/binance.service';
import { BitpandaService } from '../../exchange/services/bitpanda.service';
import { BitstampService } from '../../exchange/services/bitstamp.service';
import { FixerService } from '../../exchange/services/fixer.service';
import { KrakenService } from '../../exchange/services/kraken.service';
import { NativeCoin, StableCoin, Fiat } from '../enums';
import { PriceRequest, PriceResult } from '../interfaces';
import { PricePath } from '../utils/price-path';
import { PriceStep } from '../utils/price-step';

export enum PricingPathAlias {
  TO_BTC = 'ToBTC',
  TO_NATIVE_COIN = 'ToNativeCoin',
  MATCHING_FIAT_TO_STABLE_COIN = 'MatchingFiatToStableCoin',
  MATCHING_ASSETS = 'MatchingAssets',
  NON_MATCHING_FIAT_TO_STABLE_COIN = 'NonMatchingFiatToStableCoin',
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
      new PricePath(PricingPathAlias.TO_BTC, [
        new PriceStep({
          to: 'BTC',
          vendors: {
            primary: this.krakenService,
            secondary: [this.binanceService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.TO_NATIVE_COIN, [
        new PriceStep({
          to: 'BTC',
          vendors: {
            primary: this.krakenService,
            secondary: [this.binanceService, this.bitstampService, this.bitpandaService],
          },
        }),
        new PriceStep({
          from: 'BTC',
          vendors: {
            primary: this.binanceService,
            secondary: [this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.MATCHING_FIAT_TO_STABLE_COIN, [
        new PriceStep({
          fixedPrice: 1,
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.MATCHING_ASSETS, [
        new PriceStep({
          fixedPrice: 1,
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.NON_MATCHING_FIAT_TO_STABLE_COIN, [
        new PriceStep({
          vendors: {
            primary: this.fixerService,
            secondary: [],
          },
        }),
      ]),
    );
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

    if (to === 'BTC') return PricingPathAlias.TO_BTC;

    if (Object.values(NativeCoin).includes(to as unknown as NativeCoin)) return PricingPathAlias.TO_NATIVE_COIN;

    if (from === 'USD' && [StableCoin.USDC, StableCoin.USDT].includes(to as unknown as StableCoin)) {
      return PricingPathAlias.MATCHING_FIAT_TO_STABLE_COIN;
    }

    if (
      Object.values(Fiat).includes(from as unknown as Fiat) &&
      Object.values(StableCoin).includes(to as unknown as StableCoin)
    ) {
      return PricingPathAlias.NON_MATCHING_FIAT_TO_STABLE_COIN;
    }

    throw new Error('No matching pricing path found');
  }
}
