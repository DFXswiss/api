import { Injectable } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
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

  async getPrice(from: Asset | Fiat, to: Asset | Fiat, allowExpired: boolean): Promise<Price> {
    if (this.areEqual(from, to)) return Price.create(from.name, to.name, 1);

    const fromPrice = await this.getPriceFor(from, allowExpired);
    const toPrice = await this.getPriceFor(to, allowExpired);

    if (fromPrice.target !== toPrice.target)
      throw new Error(`Price reference mismatch: ${this.getItemString(from)} -> ${this.getItemString(to)}`);

    const price = Price.join(fromPrice, toPrice.invert());

    if (!price.isValid && !allowExpired)
      throw new PriceInvalidException(
        `No valid price found for ${this.getItemString(from)} -> ${this.getItemString(to)}`,
      );

    return price;
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
  private async getPriceFor(item: Asset | Fiat, allowExpired: boolean): Promise<Price> {
    let rule = await this.getRuleFor(item);
    if (!rule) return Price.create(item.name, item.name, 1);

    const referencePrice = await this.getPriceFor(rule.reference, allowExpired);

    if (!rule.isPriceValid) {
      const updateTask = this.updatePriceFor(rule, item, rule.reference);
      if (!allowExpired || rule.isPriceObsolete) {
        rule = await updateTask;
      }
    }

    return Price.join(rule.price, referencePrice);
  }

  private async getRuleFor(item: Asset | Fiat): Promise<PriceRule | undefined> {
    const query = this.priceRuleRepo.createQueryBuilder('rule');
    this.isFiat(item) ? query.innerJoin('rule.fiats', 'item') : query.innerJoin('rule.assets', 'item');

    return query.innerJoinAndSelect('rule.reference', 'reference').where('item.id = :id', { id: item.id }).getOne();
  }

  private async updatePriceFor(rule: PriceRule, from?: Asset | Fiat, to?: Asset | Fiat): Promise<PriceRule> {
    try {
      const price = await this.getRulePrice(rule.rule);
      from && (price.source = from.name);
      to && (price.target = to.name);

      if ((await this.isPriceValid(price, rule.check1)) && (await this.isPriceValid(price, rule.check2))) {
        rule.currentPrice = price.price;
        rule.priceTimestamp = new Date();
        return await this.priceRuleRepo.save(rule);
      }
    } catch (e) {
      this.logger.error(`Failed to update price for rule ${rule.id}:`, e);
    }

    return rule;
  }

  private async isPriceValid(price: Price, rule?: Rule): Promise<boolean> {
    if (!rule) return true;

    const rulePrice = await this.getRulePrice(rule);
    const difference = Math.abs(rulePrice.price - price.price) / price.price;

    if (difference > rule.limit) {
      const message = `${price.source} to ${price.target} has ${Util.toPercent(
        difference,
      )} price mismatch (limit is ${Util.toPercent(rule.limit)})`;

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
  private isFiat(item: Asset | Fiat): item is Fiat {
    return item instanceof Fiat;
  }

  private getItemString(item: Asset | Fiat): string {
    return `${this.isFiat(item) ? 'fiat' : 'asset'} ${item.id}`;
  }

  private areEqual(a: Asset | Fiat, b: Asset | Fiat): boolean {
    return a.constructor === b.constructor && a.id === b.id;
  }

  private async getRulePrice(rule: Rule): Promise<Price> {
    return this.priceCache.get(`${rule.source}:${rule.asset}/${rule.reference}`, () =>
      this.getPriceFrom(rule.source, rule.asset, rule.reference),
    );
  }
}
