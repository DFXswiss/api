import { Injectable } from '@nestjs/common';
import { KucoinService } from 'src/integration/exchange/services/kucoin.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { BinanceService } from '../../../../integration/exchange/services/binance.service';
import { BitpandaService } from '../../../../integration/exchange/services/bitpanda.service';
import { BitstampService } from '../../../../integration/exchange/services/bitstamp.service';
import { KrakenService } from '../../../../integration/exchange/services/kraken.service';
import { BadPriceRequestException } from '../domain/exceptions/bad-price-request.exception';
import { PathNotConfiguredException } from '../domain/exceptions/path-not-configured.exception';
import { PriceMismatchException } from '../domain/exceptions/price-mismatch.exception';
import { PriceRequest, PriceResult } from '../domain/interfaces';
import { PricePath } from '../utils/price-path';
import { PriceStep } from '../utils/price-step';
import { PricingUtil } from '../utils/pricing.util';
import { CurrencyService } from './integration/currency.service';
import { FixerService } from './integration/fixer.service';
import { PricingCoinGeckoService } from './integration/pricing-coin-gecko.service';
import { PricingDeFiChainService } from './integration/pricing-defichain.service';

export enum PricingPathAlias {
  MATCHING_ASSETS = 'MatchingAssets',
  FIAT_TO_BTC = 'FiatToBTC',
  ALTCOIN_TO_BTC = 'AltcoinToBTC',
  FIAT_TO_ALTCOIN = 'FiatToAltcoin',
  ALTCOIN_TO_ALTCOIN = 'AltcoinToAltcoin',
  BTC_TO_ALTCOIN = 'BTCToAltcoin',
  FIAT_TO_SPECIALCOIN = 'FiatToSpecialcoin',
  BTC_TO_USD_STABLE_COIN = 'BTCToUSDStableCoin',
  MATCHING_FIAT_TO_STABLE_COIN = 'MatchingFiatToStableCoin',
  NON_MATCHING_FIAT_TO_USD_STABLE_COIN = 'NonMatchingFiatToUSDStableCoin',
  NON_MATCHING_FIAT_TO_CHF_STABLE_COIN = 'NonMatchingFiatToChfStableCoin',
  FIAT_TO_DFI = 'FiatToDfi',
}

/**
 * Payment pricing service - use this service for exact swap prices
 */
@Injectable()
export class PricingService {
  private readonly logger = new DfxLogger(PricingService);

  private readonly pricingPaths: Map<PricingPathAlias, PricePath> = new Map();

  constructor(
    private readonly notificationService: NotificationService,
    private readonly krakenService: KrakenService,
    private readonly binanceService: BinanceService,
    private readonly bitstampService: BitstampService,
    private readonly bitpandaService: BitpandaService,
    private readonly kucoinService: KucoinService,
    private readonly currencyService: CurrencyService,
    private readonly fixerService: FixerService,
    private readonly defichainService: PricingDeFiChainService,
    private readonly coinGeckoService: PricingCoinGeckoService,
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
      this.logger.error('Failed to get price path:', e);
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
          primary: {
            overwrite: 'BTC',
            providers: [this.krakenService],
          },
          reference: {
            overwrite: 'BTC',
            providers: [this.binanceService, this.bitstampService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.ALTCOIN_TO_BTC, [
        new PriceStep({
          primary: {
            fallback: 'BTC',
            providers: [this.binanceService],
          },
          reference: {
            fallback: 'BTC',
            providers: [this.kucoinService, this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.FIAT_TO_ALTCOIN, [
        new PriceStep({
          to: 'BTC',
          primary: {
            providers: [this.krakenService],
          },
          reference: {
            providers: [this.binanceService, this.bitstampService],
          },
        }),
        new PriceStep({
          from: 'BTC',
          primary: {
            providers: [this.binanceService],
          },
          reference: {
            providers: [this.kucoinService, this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.ALTCOIN_TO_ALTCOIN, [
        new PriceStep({
          to: 'BTC',
          primary: {
            providers: [this.binanceService],
          },
          reference: {
            providers: [this.kucoinService, this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
        new PriceStep({
          from: 'BTC',
          primary: {
            providers: [this.binanceService],
          },
          reference: {
            providers: [this.kucoinService, this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.BTC_TO_ALTCOIN, [
        new PriceStep({
          primary: {
            providers: [this.binanceService],
          },
          reference: {
            providers: [this.kucoinService, this.krakenService, this.bitstampService, this.bitpandaService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.BTC_TO_USD_STABLE_COIN, [
        new PriceStep({
          primary: {
            providers: [this.krakenService],
          },
          reference: {
            providers: [this.binanceService, this.bitstampService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.FIAT_TO_SPECIALCOIN, [
        new PriceStep({
          primary: {
            providers: [this.coinGeckoService],
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
      new PricePath(PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN, [
        new PriceStep({
          primary: {
            fallback: 'USDT',
            providers: [this.krakenService],
          },
          reference: {
            overwrite: 'USD',
            providers: [this.fixerService, this.currencyService],
          },
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.NON_MATCHING_FIAT_TO_CHF_STABLE_COIN, [
        new PriceStep({
          primary: {
            overwrite: 'CHF',
            providers: [this.fixerService, this.currencyService],
          },
          factor: 1 / 0.995,
        }),
      ]),
    );

    this.addPath(
      new PricePath(PricingPathAlias.FIAT_TO_DFI, [
        new PriceStep({
          to: 'BTC',
          primary: {
            providers: [this.krakenService],
          },
          reference: {
            providers: [this.binanceService, this.bitstampService],
          },
        }),
        new PriceStep({
          from: 'BTC',
          primary: {
            providers: [this.defichainService],
          },
          reference: {
            providers: [],
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

    if (PricingUtil.isFiat(from) && PricingUtil.isBTC(to)) return PricingPathAlias.FIAT_TO_BTC;

    if (PricingUtil.isAltcoin(from) && PricingUtil.isBTC(to)) return PricingPathAlias.ALTCOIN_TO_BTC;

    if (PricingUtil.isFiat(from) && PricingUtil.isAltcoin(to)) return PricingPathAlias.FIAT_TO_ALTCOIN;

    if (PricingUtil.isAltcoin(from) && PricingUtil.isAltcoin(to)) return PricingPathAlias.ALTCOIN_TO_ALTCOIN;

    if (PricingUtil.isBTC(from) && PricingUtil.isAltcoin(to)) return PricingPathAlias.BTC_TO_ALTCOIN;

    if (PricingUtil.isBTC(from) && PricingUtil.isBTC(to)) return PricingPathAlias.BTC_TO_ALTCOIN;

    if (PricingUtil.isFiat(from) && PricingUtil.isSpecialCoin(to)) return PricingPathAlias.FIAT_TO_SPECIALCOIN;

    if (PricingUtil.isBTC(from) && PricingUtil.isUsdStablecoin(to)) return PricingPathAlias.BTC_TO_USD_STABLE_COIN;

    if (from === 'USD' && PricingUtil.isUsdStablecoin(to)) return PricingPathAlias.MATCHING_FIAT_TO_STABLE_COIN;
    if (from === 'CHF' && PricingUtil.isChfStablecoin(to)) return PricingPathAlias.MATCHING_FIAT_TO_STABLE_COIN;

    if (PricingUtil.isFiat(from) && PricingUtil.isUsdStablecoin(to))
      return PricingPathAlias.NON_MATCHING_FIAT_TO_USD_STABLE_COIN;
    if (PricingUtil.isFiat(from) && PricingUtil.isChfStablecoin(to))
      return PricingPathAlias.NON_MATCHING_FIAT_TO_CHF_STABLE_COIN;

    if (PricingUtil.isUsdStablecoin(from) && PricingUtil.isUsdStablecoin(to)) {
      return PricingPathAlias.MATCHING_ASSETS;
    }

    if (PricingUtil.isFiat(from) && to === 'DFI') return PricingPathAlias.FIAT_TO_DFI;

    throw new Error(`No matching pricing path alias found. From: ${request.from} to: ${request.to}`);
  }

  private logPriceResult(request: PriceRequest, result: PriceResult, pathAlias: PricingPathAlias): void {
    const { from, to } = request;
    const {
      price: { source: resFrom, target: resTo, price },
      path,
    } = result;

    const mainMessage = `Calculated Price for request from: ${from} to: ${to}. Final price: ${resFrom}/${resTo} ${price}. Alias: ${pathAlias}. `;
    const pathMessage =
      'Path: ' + path.map((p) => ` ${p.provider} -> ${p.price.source}/${p.price.target} ${p.price.price}`);

    this.logger.verbose(mainMessage + pathMessage);
  }
}
