import { Injectable, OnModuleInit } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { KucoinService } from 'src/integration/exchange/services/kucoin.service';
import { MexcService } from 'src/integration/exchange/services/mexc.service';
import { ScryptService } from 'src/integration/exchange/services/scrypt.service';
import { XtService } from 'src/integration/exchange/services/xt.service';
import { Active, activesEqual, isAsset, isFiat } from 'src/shared/models/active';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from '../../notification/enums';
import { NotificationService } from '../../notification/services/notification.service';
import { Price } from '../domain/entities/price';
import { PriceRule, PriceSource, Rule } from '../domain/entities/price-rule.entity';
import { PriceInvalidException } from '../domain/exceptions/price-invalid.exception';
import { PricingProviderMap } from '../domain/interfaces';
import { PriceRuleRepository } from '../repositories/price-rule.repository';
import { AssetPricesService } from './asset-prices.service';
import { CoinGeckoService } from './integration/coin-gecko.service';
import { CurrencyService } from './integration/currency.service';
import { FixerService } from './integration/fixer.service';
import { PricingConstantService } from './integration/pricing-constant.service';
import { PricingDeuroService } from './integration/pricing-deuro.service';
import { PricingDexService } from './integration/pricing-dex.service';
import { PricingEbel2xService } from './integration/pricing-ebel2x.service';
import { PricingJuiceService } from './integration/pricing-juice.service';
import { PricingFrankencoinService } from './integration/pricing-frankencoin.service';
import { PricingRealUnitService } from './integration/pricing-realunit.service';

export enum PriceCurrency {
  EUR = 'EUR',
  CHF = 'CHF',
  USD = 'USD',
}

export enum PriceValidity {
  ANY = 'Any',
  PREFER_VALID = 'PreferValid',
  VALID_ONLY = 'ValidOnly',
}

@Injectable()
export class PricingService implements OnModuleInit {
  private readonly logger = new DfxLogger(PricingService);

  private readonly fiatMap = new Map<PriceCurrency, Fiat>();
  private readonly providerMap: PricingProviderMap;
  private readonly priceRuleCache = new AsyncCache<PriceRule[]>(CacheItemResetPeriod.EVERY_6_HOURS);
  private readonly providerPriceCache = new AsyncCache<Price>(CacheItemResetPeriod.EVERY_10_SECONDS);
  private readonly updateCalls = new AsyncCache<PriceRule>(CacheItemResetPeriod.ALWAYS);

  constructor(
    private readonly priceRuleRepo: PriceRuleRepository,
    private readonly notificationService: NotificationService,
    private readonly fiatService: FiatService,
    private readonly assetPriceService: AssetPricesService,
    readonly krakenService: KrakenService,
    readonly binanceService: BinanceService,
    readonly kucoinService: KucoinService,
    readonly mexcService: MexcService,
    readonly xtService: XtService,
    readonly scryptService: ScryptService,
    readonly coinGeckoService: CoinGeckoService,
    readonly dexService: PricingDexService,
    readonly fixerService: FixerService,
    readonly currencyService: CurrencyService,
    readonly frankencoinService: PricingFrankencoinService,
    readonly deuroService: PricingDeuroService,
    readonly juiceService: PricingJuiceService,
    readonly ebel2xService: PricingEbel2xService,
    readonly realunitService: PricingRealUnitService,
    readonly constantService: PricingConstantService,
  ) {
    this.providerMap = {
      [PriceSource.KRAKEN]: krakenService,
      [PriceSource.BINANCE]: binanceService,
      [PriceSource.KUCOIN]: kucoinService,
      [PriceSource.MEXC]: mexcService,
      [PriceSource.XT]: xtService,
      [PriceSource.SCRYPT]: scryptService,
      [PriceSource.COIN_GECKO]: coinGeckoService,
      [PriceSource.DEX]: dexService,
      [PriceSource.FIXER]: fixerService,
      [PriceSource.CURRENCY]: currencyService,
      [PriceSource.FRANKENCOIN]: frankencoinService,
      [PriceSource.DEURO]: deuroService,
      [PriceSource.JUICE]: juiceService,
      [PriceSource.EBEL2X]: ebel2xService,
      [PriceSource.REALUNIT]: realunitService,
      [PriceSource.CONSTANT]: constantService,
    };
  }

  async onModuleInit() {
    const [chf, eur, usd] = await Promise.all([
      this.fiatService.getFiatByName('CHF'),
      this.fiatService.getFiatByName('EUR'),
      this.fiatService.getFiatByName('USD'),
    ]);

    if (chf) this.fiatMap.set(PriceCurrency.CHF, chf);
    if (eur) this.fiatMap.set(PriceCurrency.EUR, eur);
    if (usd) this.fiatMap.set(PriceCurrency.USD, usd);
  }

  async getPrice(
    from: Active | PriceCurrency,
    to: Active | PriceCurrency,
    validity: PriceValidity,
    tryCount = 2,
  ): Promise<Price> {
    const fromActive = this.getEntity(from);
    const toActive = this.getEntity(to);

    return this.getAssetPrice(fromActive, toActive, validity, tryCount);
  }

  async getPriceAt(from: Active | PriceCurrency, to: Active | PriceCurrency, date: Date): Promise<Price> {
    const fromActive = this.getEntity(from);
    const toActive = this.getEntity(to);

    if (isAsset(fromActive)) {
      if (isAsset(toActive)) {
        // asset -> asset
        const [fromPrice, toPrice] = await Promise.all([
          this.getHistoricalAssetPrice(this.fiatMap.get(PriceCurrency.CHF), fromActive, date),
          this.getHistoricalAssetPrice(this.fiatMap.get(PriceCurrency.CHF), toActive, date),
        ]);
        return Price.join(fromPrice.invert(), toPrice);
      } else {
        // asset -> fiat
        return this.getHistoricalAssetPrice(toActive, fromActive, date).then((p) => p.invert());
      }
    } else if (isAsset(toActive)) {
      // fiat -> asset
      return this.getHistoricalAssetPrice(fromActive, toActive, date);
    }

    throw new Error(`No historical price available for ${this.itemString(fromActive)} -> ${this.itemString(toActive)}`);
  }

  async getPriceFrom(source: PriceSource, from: string, to: string, param?: string): Promise<Price> {
    return this.providerMap[source].getPrice(from, to, param);
  }

  async updatePrices(): Promise<void> {
    const rules = await this.priceRuleRepo.find();
    for (const rule of rules) {
      await this.doUpdatePriceFor(rule);
    }
  }

  // --- PRIVATE METHODS --- //
  private getEntity(asset: Active | PriceCurrency): Active {
    return typeof asset === 'object' ? asset : this.fiatMap.get(asset);
  }

  private async getHistoricalAssetPrice(fiat: Fiat, asset: Asset, date: Date): Promise<Price> {
    const price = await this.assetPriceService.getAssetPriceForDate(asset.id, date);

    let priceValue: number;

    const currency = Util.toEnum(PriceCurrency, fiat.name);
    switch (currency) {
      case PriceCurrency.USD:
        priceValue = price?.priceUsd;
        break;
      case PriceCurrency.CHF:
        priceValue = price?.priceChf;
        break;
      case PriceCurrency.EUR:
        priceValue = price?.priceEur;
        break;
    }

    if (!priceValue)
      throw new Error(`No price found for ${this.itemString(fiat)} -> ${this.itemString(asset)} on ${date}`);

    return Price.create(currency, asset.name, priceValue, false, date);
  }

  private async getAssetPrice(from: Active, to: Active, validity: PriceValidity, tryCount: number): Promise<Price> {
    try {
      if (activesEqual(from, to)) return Price.create(from.name, to.name, 1);

      const shouldUpdate = validity !== PriceValidity.ANY;

      const [fromRules, toRules] = await Promise.all([
        this.priceRuleCache.get(
          this.itemString(from),
          () => this.getPriceRules(from, shouldUpdate),
          (rules) => shouldUpdate && !this.joinRules(rules).isValid,
        ),
        this.priceRuleCache.get(
          this.itemString(to),
          () => this.getPriceRules(to, shouldUpdate),
          (rules) => shouldUpdate && !this.joinRules(rules).isValid,
        ),
      ]);

      const price = Price.join(this.joinRules(fromRules), this.joinRules(toRules).invert());

      if (!price.isValid && validity === PriceValidity.VALID_ONLY) {
        if (tryCount > 1) return await this.getPrice(from, to, validity, tryCount - 1);
        throw new Error(`Price invalid (fetched on ${price.timestamp})`);
      }

      if (Math.abs(price.price - 1) < 0.01) price.price = 1;
      price.source = from.name;
      price.target = to.name;

      return price;
    } catch (e) {
      this.logger.info(`Failed to get price for ${this.itemString(from)} -> ${this.itemString(to)}:`, e);

      throw new PriceInvalidException(`No valid price found for ${from.name} -> ${to.name}`);
    }
  }

  private async getPriceRules(item: Active, waitForUpdate: boolean): Promise<PriceRule[]> {
    const rules: { active: Active; rule: PriceRule }[] = [];

    let rule: PriceRule;
    do {
      const active = rule?.reference ?? item;
      rule = await this.getRuleFor(active);
      if (!rule) throw new Error(`No price rule found for ${this.itemString(active)}`);

      rules.push({ active, rule });
    } while (rule.reference);

    return Promise.all(rules.map(({ active, rule }) => this.updatePriceForRule(rule, waitForUpdate, active)));
  }

  private async getRuleFor(item: Active): Promise<PriceRule | undefined> {
    const query = this.priceRuleRepo.createQueryBuilder('rule');
    if (isFiat(item)) {
      query.innerJoin('rule.fiats', 'item');
    } else {
      query.innerJoin('rule.assets', 'item');
    }

    return query.leftJoinAndSelect('rule.reference', 'reference').where('item.id = :id', { id: item.id }).getOne();
  }

  private async updatePriceForRule(rule: PriceRule, waitForUpdate: boolean, active?: Active): Promise<PriceRule> {
    if (rule.shouldUpdate) {
      const updateTask = this.updateCalls.get(`${rule.id}`, () => this.doUpdatePriceFor(rule, active));

      if (waitForUpdate || rule.currentPrice == null || rule.isPriceObsolete) {
        rule = await updateTask;
      } else {
        updateTask.catch((e) => this.logger.error(`Failed to update price for rule ${rule.id} in background:`, e));
      }
    }

    return rule;
  }

  private async doUpdatePriceFor(rule: PriceRule, from?: Active): Promise<PriceRule> {
    const [price, check1Price, check2Price] = await Promise.all([
      this.getRulePrice(rule.rule),
      rule.check1 && this.getRulePrice(rule.check1),
      rule.check2 && this.getRulePrice(rule.check2),
    ]);

    const source = from?.name ?? price.source;
    const target = rule.reference?.name ?? price.target;

    if (
      (await this.isPriceValid(source, target, price.price, rule.check1, check1Price)) &&
      (await this.isPriceValid(source, target, price.price, rule.check2, check2Price))
    ) {
      rule.currentPrice = price.price;
      rule.priceTimestamp = new Date();
      return this.priceRuleRepo.save(rule);
    }

    return rule;
  }

  private async isPriceValid(
    from: string,
    to: string,
    price: number,
    rule?: Rule,
    rulePrice?: Price,
  ): Promise<boolean> {
    if (!rule || !rulePrice) return true;

    const difference = Math.abs(rulePrice.price - price) / price;

    if (difference > rule.limit) {
      const message = `${from} to ${to} has ${Util.toPercent(difference)} price mismatch on ${
        rule.source
      } (limit is ${Util.toPercent(rule.limit)})`;

      this.logger.verbose(message);
      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        context: MailContext.PRICING,
        input: { subject: 'Price Mismatch', errors: [message], isLiqMail: true },
        correlationId: `PriceMismatch&${rule.asset}&${rule.reference}`,
        options: { debounce: 86400000 },
      });

      return false;
    }

    return true;
  }

  // --- HELPER METHODS --- //
  private itemString(item: Active): string {
    return `${isFiat(item) ? 'fiat' : 'asset'} ${item.id}`;
  }

  private joinRules(rules: PriceRule[]): Price {
    return Price.join(...rules.map((r) => r.getPrice(this.providerMap)));
  }

  private async getRulePrice(rule: Rule): Promise<Price> {
    return this.providerPriceCache
      .get(`${rule.source}:${rule.asset}/${rule.reference}`, () =>
        this.getPriceFrom(rule.source, rule.asset, rule.reference, rule.param),
      )
      .catch((e) => {
        throw new Error(`Failed to get price ${rule.asset} -> ${rule.reference} on ${rule.source}: ${e.message}`);
      });
  }
}
