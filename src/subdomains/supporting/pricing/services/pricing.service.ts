import { Injectable } from '@nestjs/common';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { PriceMismatchException } from '../../../../integration/exchange/exceptions/price-mismatch.exception';
import { BinanceService } from '../../../../integration/exchange/services/binance.service';
import { BitpandaService } from '../../../../integration/exchange/services/bitpanda.service';
import { BitstampService } from '../../../../integration/exchange/services/bitstamp.service';
import { CurrencyService } from '../../../../integration/exchange/services/currency.service';
import { FixerService } from '../../../../integration/exchange/services/fixer.service';
import { FtxService } from '../../../../integration/exchange/services/ftx.service';
import { KrakenService } from '../../../../integration/exchange/services/kraken.service';
import { BadPriceRequestException } from '../exceptions/bad-price-request.exception';
import { PathNotConfiguredException } from '../exceptions/path-not-configured.exception';
import { PriceRequest, PriceResult } from '../interfaces';
import { PricePath } from '../utils/price-path';
import { PriceStep } from '../utils/price-step';
import { PricingUtil } from '../utils/pricing.util';
import { DfiPricingDexService } from './dfi-pricing-dex.service';

export enum PricingPathAlias {
  MATCHING_ASSETS = 'MatchingAssets',
  FIAT_TO_BTC = 'FiatToBTC',
  ALTCOIN_TO_BTC = 'AltcoinToBTC',
  FIAT_TO_ALTCOIN = 'FiatToAltcoin',
  ALTCOIN_TO_ALTCOIN = 'AltcoinToAltcoin',
  BTC_TO_ALTCOIN = 'BTCToAltcoin',
  MATCHING_FIAT_TO_USD_STABLE_COIN = 'MatchingFiatToUSDStableCoin',
  NON_MATCHING_FIAT_TO_USD_STABLE_COIN = 'NonMatchingFiatToUSDStableCoin',
  NON_MATCHING_USD_STABLE_COIN_TO_USD_STABLE_COIN = 'NonMatchingUSDStableCoinToUSDStableCoin',
  FIAT_TO_DFI = 'FiatToDfi',
  DFI_TO_NON_FIAT = 'DfiToNonFiat',
  ALTCOIN_TO_USD_STABLE_COIN = 'AltcoinToUSDStableCoin',
}

@Injectable()
export class PricingService {
  private readonly pricingPaths: Map<PricingPathAlias, PricePath> = new Map();

  constructor(
    private readonly notificationService: NotificationService,
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
    private readonly bitpandaService: BitpandaService,
    private readonly ftxService: FtxService,
    private readonly currencyService: CurrencyService,
    private readonly fixerService: FixerService,
    private readonly dfiDexService: DfiPricingDexService,
  ) {
    this.configurePaths();
  }

  //*** PUBLIC API ***//

  async getPrice(request: PriceRequest): Promise<PriceResult> {
    this.validatePriceRequest(request);

    let path: PricePath;

    try {
      path = this.getPath(request);
    } catch (e) {
      console.error(e);
      throw new PathNotConfiguredException(request.from, request.to);
    }

    try {
      const result = await path.execute(request);

      this.logPriceResult(request, result, path.alias);

      return result;
    } catch (e) {
      if (e instanceof PriceMismatchException) {
        await this.notificationService.sendMail({
          type: MailType.ERROR_MONITORING,
          input: { subject: 'Exchange Price Mismatch', errors: [e.message] },
          metadata: {
            context: MailContext.PRICING,
            correlationId: `PriceMismatch&${request.context}&${request.correlationId}&${request.to}&${request.from}`,
          },
          options: {
            debounce: 1800000,
          },
        });
      }

      throw e;
    }
  }

  //*** CONFIGURATION ***//

  private configurePaths(): void {
    this.addPath(
      new PricePath(PricingPathAlias.MATCHING_ASSETS, [
        new PriceStep({
          fixedPrice: 1,
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.FIAT_TO_BTC, [
        new PriceStep({
          providers: {
            primary: [this.krakenService],
            reference: [this.binanceService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.ALTCOIN_TO_BTC, [
        new PriceStep({
          providers: {
            primary: [this.binanceService],
            reference: [this.ftxService, this.krakenService, this.bitstampService, this.bitpandaService],
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
            reference: [this.ftxService, this.krakenService, this.bitstampService, this.bitpandaService],
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
            reference: [this.ftxService, this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
        new PriceStep({
          from: 'BTC',
          providers: {
            primary: [this.binanceService],
            reference: [this.ftxService, this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.BTC_TO_ALTCOIN, [
        new PriceStep({
          providers: {
            primary: [this.binanceService],
            reference: [this.ftxService, this.krakenService, this.bitstampService, this.bitpandaService],
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
          overwriteReferenceTo: 'USD',
          fallbackPrimaryTo: 'USDT',
          providers: {
            primary: [this.krakenService],
            reference: [this.fixerService, this.currencyService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.NON_MATCHING_USD_STABLE_COIN_TO_USD_STABLE_COIN, [
        new PriceStep({
          fixedPrice: 1,
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.FIAT_TO_DFI, [
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
            primary: [this.dfiDexService],
            reference: [],
          },
        }),
      ]),
    );

    //*** INDICATIVE PRICES ***//

    this.addPath(
      new PricePath(PricingPathAlias.DFI_TO_NON_FIAT, [
        new PriceStep({
          providers: {
            primary: [this.dfiDexService],
            reference: [],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.ALTCOIN_TO_USD_STABLE_COIN, [
        new PriceStep({
          providers: {
            primary: [this.binanceService],
            reference: [],
          },
        }),
      ]),
    );
  }

  //*** HELPER METHODS ***//

  private validatePriceRequest(request: PriceRequest): void {
    const { from, to } = request;

    const isKnownFrom = PricingUtil.isKnownAsset(from);
    const isKnownTo = PricingUtil.isKnownAsset(to);

    if (!isKnownFrom || !isKnownTo) {
      throw new BadPriceRequestException(!isKnownFrom && from, !isKnownTo && to);
    }
  }

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

    if (PricingUtil.isFiat(from) && to === 'BTC') return PricingPathAlias.FIAT_TO_BTC;

    if (PricingUtil.isAltcoin(from) && to === 'BTC') return PricingPathAlias.ALTCOIN_TO_BTC;

    if (PricingUtil.isFiat(from) && PricingUtil.isAltcoin(to)) return PricingPathAlias.FIAT_TO_ALTCOIN;

    if (PricingUtil.isAltcoin(from) && PricingUtil.isAltcoin(to)) return PricingPathAlias.ALTCOIN_TO_ALTCOIN;

    if (from === 'BTC' && PricingUtil.isAltcoin(to)) return PricingPathAlias.BTC_TO_ALTCOIN;

    if (from === 'USD' && PricingUtil.isUSDStablecoin(to)) return PricingPathAlias.MATCHING_FIAT_TO_USD_STABLE_COIN;

    if (PricingUtil.isFiat(from) && PricingUtil.isUSDStablecoin(to))
      return PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN;

    if (PricingUtil.isUSDStablecoin(from) && PricingUtil.isUSDStablecoin(to) && from !== to) {
      return PricingPathAlias.NON_MATCHING_USD_STABLE_COIN_TO_USD_STABLE_COIN;
    }

    if (PricingUtil.isFiat(from) && to === 'DFI') return PricingPathAlias.FIAT_TO_DFI;

    if (from === 'DFI' && !PricingUtil.isFiat(to)) return PricingPathAlias.DFI_TO_NON_FIAT;

    if (PricingUtil.isAltcoin(from) && PricingUtil.isUSDStablecoin(to))
      return PricingPathAlias.ALTCOIN_TO_USD_STABLE_COIN;

    throw new Error(`No matching pricing path alias found. From: ${request.from} to: ${request.to}`);
  }

  private logPriceResult(request: PriceRequest, result: PriceResult, pathAlias: PricingPathAlias): void {
    const { from, to } = request;
    const {
      price: { source: resFrom, target: resTo, price },
      path,
    } = result;

    const mainMessage = `Calculated Price for request from: ${from} to: ${to}. Final price: ${resTo}/${resFrom} ${price}. Alias: ${pathAlias}`;
    const pathMessage =
      'Path: ' + path.map((p) => ` ${p.provider} -> ${p.price.target}/${p.price.source} ${p.price.price}`);

    console.info(mainMessage + pathMessage);
  }
}
