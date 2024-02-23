import { Injectable } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { Active, isFiat } from 'src/shared/models/active';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { AsyncCache } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
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

@Injectable()
export class PricingService {
  private readonly logger = new DfxLogger(PricingService);

  private readonly providerMap: { [s in PriceSource]: PricingProvider };
  private readonly priceCache = new AsyncCache<Price>(10);

  constructor(
    private readonly priceRuleRepo: PriceRuleRepository,
    private readonly notificationService: NotificationService,
    readonly krakenService: KrakenService,
    readonly binanceService: BinanceService,
    readonly coinGeckoService: CoinGeckoService,
    readonly dexService: PricingDexService,
    readonly fixerService: FixerService,
    readonly currencyService: CurrencyService,
    readonly frankencoinService: PricingFrankencoinService,
  ) {
    this.providerMap = {
      [PriceSource.KRAKEN]: krakenService,
      [PriceSource.BINANCE]: binanceService,
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

      const fromPrice = await this.getPriceFor(from, allowExpired);
      const toPrice = await this.getPriceFor(to, allowExpired);

      const price = Price.join(fromPrice, toPrice.invert());

      if (fromPrice.target !== toPrice.target) throw new Error('Price reference mismatch');
      if (!price.isValid && !allowExpired) throw new Error('Price invalid');

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
  private async getPriceFor(item: Active, allowExpired: boolean): Promise<Price> {
    let rule = await this.getRuleFor(item);
    if (!rule) throw new Error(`No price rule found for ${this.getItemString(item)}`);

    const referencePrice = rule.reference
      ? await this.getPriceFor(rule.reference, allowExpired)
      : Price.create('DFX-USD', 'DFX-USD', 1);

    if (!rule.isPriceValid) {
      const updateTask = this.updatePriceFor(rule, item, rule.reference);

      if (!allowExpired || rule.currentPrice == null || rule.isPriceObsolete) {
        rule = await updateTask;
      } else {
        updateTask.catch((e) => this.logger.error(`Failed to update price for rule ${rule.id}:`, e));
      }
    }

    return Price.join(rule.price, referencePrice);
  }

  private async getRuleFor(item: Active): Promise<PriceRule | undefined> {
    const query = this.priceRuleRepo.createQueryBuilder('rule');
    isFiat(item) ? query.innerJoin('rule.fiats', 'item') : query.innerJoin('rule.assets', 'item');

    return query.leftJoinAndSelect('rule.reference', 'reference').where('item.id = :id', { id: item.id }).getOne();
  }

  private async updatePriceFor(rule: PriceRule, from?: Active, to?: Active): Promise<PriceRule> {
    const price = await this.getRulePrice(rule.rule);
    const source = from?.name ?? price.source;
    const target = to?.name ?? price.target;

    if (
      (await this.isPriceValid(source, target, price.price, rule.check1)) &&
      (await this.isPriceValid(source, target, price.price, rule.check2))
    ) {
      rule.currentPrice = price.price;
      rule.priceTimestamp = new Date();
      return this.priceRuleRepo.save(rule);
    }

    return rule;
  }

  private async isPriceValid(from: string, to: string, price: number, rule?: Rule): Promise<boolean> {
    if (!rule) return true;

    const rulePrice = await this.getRulePrice(rule);
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
    return this.priceCache.get(`${rule.source}:${rule.asset}/${rule.reference}`, () =>
      this.getPriceFrom(rule.source, rule.asset, rule.reference),
    );
  }
}
