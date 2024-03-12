import { Injectable } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { KucoinService } from 'src/integration/exchange/services/kucoin.service';
import { Active, isFiat } from 'src/shared/models/active';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { In } from 'typeorm';
import { MailContext, MailType } from '../../notification/enums';
import { NotificationService } from '../../notification/services/notification.service';
import { Price } from '../domain/entities/price';
import { PriceRule, PriceSource, Rule } from '../domain/entities/price-rule.entity';
import { PriceInvalidException } from '../domain/exceptions/price-invalid.exception';
import { PricingProvider } from '../domain/interfaces';
import { PriceRuleRepository } from '../repositories/price-rule.repository';
import { CoinGeckoService } from './integration/coin-gecko.service';
import { CurrencyService } from './integration/currency.service';
import { FixerService } from './integration/fixer.service';
import { PricingDexService } from './integration/pricing-dex.service';
import { PricingFrankencoinService } from './integration/pricing-frankencoin.service';

interface PriceRuleEntry {
  active: Active;
  rule: PriceRule;
}

interface PriceRuleCacheEntry {
  active: Active;
  ruleId: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new DfxLogger(PricingService);

  private readonly providerMap: { [s in PriceSource]: PricingProvider };
  private readonly ruleCache = new Map<string, PriceRuleCacheEntry[]>();
  private readonly priceCache = new AsyncCache<Price>(10);
  private readonly updateCalls = new AsyncCache<PriceRule>(0);

  constructor(
    private readonly priceRuleRepo: PriceRuleRepository,
    private readonly notificationService: NotificationService,
    readonly krakenService: KrakenService,
    readonly binanceService: BinanceService,
    readonly kucoinService: KucoinService,
    readonly coinGeckoService: CoinGeckoService,
    readonly dexService: PricingDexService,
    readonly fixerService: FixerService,
    readonly currencyService: CurrencyService,
    readonly frankencoinService: PricingFrankencoinService,
  ) {
    this.providerMap = {
      [PriceSource.KRAKEN]: krakenService,
      [PriceSource.BINANCE]: binanceService,
      [PriceSource.KUCOIN]: kucoinService,
      [PriceSource.COIN_GECKO]: coinGeckoService,
      [PriceSource.DEX]: dexService,
      [PriceSource.FIXER]: fixerService,
      [PriceSource.CURRENCY]: currencyService,
      [PriceSource.FRANKENCOIN]: frankencoinService,
    };
  }

  async getPrice(from: Active, to: Active, allowExpired: boolean): Promise<Price> {
    try {
      if (this.areEqual(from, to)) return Price.create(from.name, to.name, 1);

      const [fromPrice, toPrice] = await Promise.all([
        this.getPriceForActive(from, allowExpired),
        this.getPriceForActive(to, allowExpired),
      ]);

      const price = Price.join(fromPrice, toPrice.invert());

      if (!price.isValid && !allowExpired) throw new Error('Price invalid');

      if (Math.abs(price.price - 1) < 0.001) price.price = 1;
      price.source = from.name;
      price.target = to.name;

      return price;
    } catch (e) {
      this.logger.error(`Failed to get price for ${this.getItemString(from)} -> ${this.getItemString(to)}:`, e);

      throw new PriceInvalidException(`No valid price found for ${from.name} -> ${to.name}`);
    }
  }

  async updatePrices(): Promise<void> {
    const rules = await this.priceRuleRepo.find();
    for (const rule of rules) {
      await this.updatePriceFor(rule);
    }
  }

  async getPriceFrom(source: PriceSource, from: string, to: string): Promise<Price> {
    return this.providerMap[source].getPrice(from, to);
  }

  // --- PRIVATE METHODS --- //
  private async getPriceForActive(item: Active, allowExpired: boolean): Promise<Price> {
    const times = [Date.now()];

    const rules = (await this.getRulesFromCache(item)) ?? (await this.loadRulesFor(item));

    times.push(Date.now());

    const prices = await Promise.all(rules.map(({ active, rule }) => this.getPriceForRule(rule, allowExpired, active)));

    times.push(Date.now());

    if (Date.now() - times[0] > 300 && allowExpired) {
      const timesString = times.map((t, i, a) => Util.round((t - (a[i - 1] ?? t)) / 1000, 3)).join(', ');
      this.logger.verbose(`Price request times for ${item.name}: ${timesString}`);
    }

    return Price.join(...prices);
  }

  private async getRulesFromCache(item: Active): Promise<PriceRuleEntry[] | undefined> {
    const entries = this.ruleCache.get(this.getItemString(item));
    if (!entries) return undefined;

    const rules = await this.priceRuleRepo.findBy({ id: In(entries.map((e) => e.ruleId)) });

    return entries.map((e) => ({ active: e.active, rule: rules.find((r) => r.id === e.ruleId) }));
  }

  private async loadRulesFor(item: Active): Promise<PriceRuleEntry[]> {
    const rules: PriceRuleEntry[] = [];

    let rule: PriceRule;
    do {
      const active = rule?.reference ?? item;
      rule = await this.loadRuleFor(active);
      if (!rule) throw new Error(`No price rule found for ${this.getItemString(active)}`);

      rules.push({ active, rule });
    } while (rule.reference);

    this.ruleCache.set(
      this.getItemString(item),
      rules.map((e) => ({ active: e.active, ruleId: e.rule.id })),
    );

    return rules;
  }

  private async loadRuleFor(item: Active): Promise<PriceRule | undefined> {
    const query = this.priceRuleRepo.createQueryBuilder('rule');
    isFiat(item) ? query.innerJoin('rule.fiats', 'item') : query.innerJoin('rule.assets', 'item');

    return query.leftJoinAndSelect('rule.reference', 'reference').where('item.id = :id', { id: item.id }).getOne();
  }

  private async getPriceForRule(rule: PriceRule, allowExpired: boolean, active?: Active): Promise<Price> {
    const start = Date.now();

    if (!rule.isPriceValid) {
      const updateTask = this.updateCalls.get(`${rule.id}`, () => this.updatePriceFor(rule, active));

      if (!allowExpired || rule.currentPrice == null || rule.isPriceObsolete) {
        rule = await updateTask;
      } else {
        updateTask.catch((e) => this.logger.error(`Failed to update price for rule ${rule.id} in background:`, e));
      }
    }

    const timeDiff = Date.now() - start;
    if (timeDiff > 300 && allowExpired) {
      this.logger.verbose(`Rule request times for ${rule.id}: ${timeDiff / 1000}`);
    }

    return rule.price;
  }

  private async updatePriceFor(rule: PriceRule, from?: Active): Promise<PriceRule> {
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

      this.logger.warn(message);
      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: { subject: 'Price Mismatch', errors: [message] },
        metadata: {
          context: MailContext.PRICING,
          correlationId: `PriceMismatch&${rule.asset}&${rule.reference}`,
        },
        options: {
          debounce: 1800000,
        },
      });

      return false;
    }

    return true;
  }

  // --- HELPER METHODS --- //
  private getItemString(item: Active): string {
    return `${isFiat(item) ? 'fiat' : 'asset'} ${item.id}`;
  }

  private areEqual(a: Active, b: Active): boolean {
    return a.constructor === b.constructor && a.id === b.id;
  }

  private async getRulePrice(rule: Rule): Promise<Price> {
    return this.priceCache
      .get(`${rule.source}:${rule.asset}/${rule.reference}`, () =>
        this.getPriceFrom(rule.source, rule.asset, rule.reference),
      )
      .catch((e) => {
        throw new Error(`Failed to get price ${rule.asset} -> ${rule.reference} on ${rule.source}: ${e.message}`);
      });
  }
}
