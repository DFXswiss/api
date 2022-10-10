import { Injectable } from '@nestjs/common';
import { MailService } from 'src/shared/services/mail.service';
import { PriceMismatchException } from '../../exchange/exceptions/price-mismatch.exception';
import { BinanceService } from '../../exchange/services/binance.service';
import { BitpandaService } from '../../exchange/services/bitpanda.service';
import { BitstampService } from '../../exchange/services/bitstamp.service';
import { CurrencyService } from '../../exchange/services/currency.service';
import { FixerService } from '../../exchange/services/fixer.service';
import { FtxService } from '../../exchange/services/ftx.service';
import { KrakenService } from '../../exchange/services/kraken.service';
import { Altcoin, USDStableCoin, Fiat } from '../enums';
import { BadPriceRequestException } from '../exceptions/bad-price-request.exception';
import { PathNotConfiguredException } from '../exceptions/path-not-configured.exception';
import { PriceRequest, PriceResult } from '../interfaces';
import { PricePath } from '../utils/price-path';
import { PriceStep } from '../utils/price-step';
import { DfiPricingDexService } from './dfi-pricing-dex.service';

export enum PricingPathAlias {
  MATCHING_ASSETS = 'MatchingAssets',
  FIAT_TO_BTC = 'FiatToBTC',
  ALTCOIN_TO_BTC = 'AltcoinToBTC',
  FIAT_TO_ALTCOIN = 'FiatToAltcoin',
  ALTCOIN_TO_ALTCOIN = 'AltcoinToAltcoin',
  BTC_TO_ALTCOIN = 'BTCToAltcoin',
  MATCHING_FIAT_TO_USD_STABLE_COIN = 'MatchingFiatToUSDStableCoin',
  NON_MATCHING_FIAT_TO_BUSD = 'NonMatchingFiatToBUSD',
  NON_MATCHING_FIAT_TO_USD_STABLE_COIN = 'NonMatchingFiatToUSDStableCoin',
  NON_MATCHING_USD_STABLE_COIN_TO_USD_STABLE_COIN = 'NonMatchingUSDStableCoinToUSDStableCoin',
  FIAT_TO_DFI = 'FiatToDfi',
}

@Injectable()
export class PricingService {
  private readonly pricingPaths: Map<PricingPathAlias, PricePath> = new Map();

  constructor(
    private readonly mailService: MailService,
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
        await this.mailService.sendErrorMail('Exchange Price Mismatch', [e.message]);
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
      new PricePath(PricingPathAlias.NON_MATCHING_FIAT_TO_BUSD, [
        new PriceStep({
          overwriteReferenceTo: 'USD',
          fallbackPrimaryTo: 'USDC',
          providers: {
            primary: [this.krakenService],
            reference: [this.fixerService, this.currencyService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN, [
        new PriceStep({
          overwriteReferenceTo: 'USD',
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
  }

  //*** HELPER METHODS ***//

  private validatePriceRequest(request: PriceRequest): void {
    const { from, to } = request;

    const isKnownFrom = this.isKnownAsset(from);
    const isKnownTo = this.isKnownAsset(to);

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

    if (this.isFiat(from) && to === 'BTC') return PricingPathAlias.FIAT_TO_BTC;

    if (this.isAltcoin(from) && to === 'BTC') return PricingPathAlias.ALTCOIN_TO_BTC;

    if (this.isFiat(from) && this.isAltcoin(to)) return PricingPathAlias.FIAT_TO_ALTCOIN;

    if (this.isAltcoin(from) && this.isAltcoin(to)) return PricingPathAlias.ALTCOIN_TO_ALTCOIN;

    if (from === 'BTC' && this.isAltcoin(to)) return PricingPathAlias.BTC_TO_ALTCOIN;

    if (from === 'USD' && this.isUSDStablecoin(to)) return PricingPathAlias.MATCHING_FIAT_TO_USD_STABLE_COIN;

    if (this.isFiat(from) && this.isUSDStablecoin(to) && to === 'BUSD')
      return PricingPathAlias.NON_MATCHING_FIAT_TO_BUSD;

    if (this.isFiat(from) && this.isUSDStablecoin(to)) return PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN;

    if (this.isUSDStablecoin(from) && this.isUSDStablecoin(to) && from !== to) {
      return PricingPathAlias.NON_MATCHING_USD_STABLE_COIN_TO_USD_STABLE_COIN;
    }

    if (this.isFiat(from) && to === 'DFI') return PricingPathAlias.FIAT_TO_DFI;

    throw new Error(`No matching pricing path alias found. From: ${request.from} to: ${request.to}`);
  }

  private isFiat(asset: string): boolean {
    return Object.values(Fiat).includes(asset as unknown as Fiat);
  }

  private isBTC(asset: string): boolean {
    return asset === 'BTC';
  }

  private isAltcoin(asset: string): boolean {
    return Object.values(Altcoin).includes(asset as unknown as Altcoin);
  }

  private isUSDStablecoin(asset: string): boolean {
    return Object.values(USDStableCoin).includes(asset as unknown as USDStableCoin);
  }

  private isKnownAsset(asset: string): boolean {
    return (
      this.isFiat(asset) || this.isBTC(asset) || this.isAltcoin(asset) || this.isUSDStablecoin(asset) || asset === 'DFI'
    );
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
