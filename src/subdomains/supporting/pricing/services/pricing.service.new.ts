import { Injectable } from '@nestjs/common';
import { BinanceService } from 'src/integration/exchange/services/binance.service';
import { KrakenService } from 'src/integration/exchange/services/kraken.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { MailContext, MailType } from '../../notification/enums';
import { NotificationService } from '../../notification/services/notification.service';
import { Price } from '../domain/entities/price';
import { PriceRule, PriceSource, Rule } from '../domain/entities/price-rule.entity';
import { PricingProvider } from '../domain/interfaces';
import { PriceRuleRepository } from '../repositories/price-rule.repository';

@Injectable()
export class PricingServiceNew {
  private readonly logger = new DfxLogger(PricingServiceNew);

  private readonly providerMap: { [s in PriceSource]: PricingProvider };

  constructor(
    private readonly priceRuleRepo: PriceRuleRepository,
    private readonly notificationService: NotificationService,
    readonly krakenService: KrakenService,
    readonly binanceService: BinanceService,
  ) {
    this.providerMap = { [PriceSource.KRAKEN]: krakenService, [PriceSource.BINANCE]: binanceService };
  }

  async getPrice(from: Asset | Fiat, to: Asset | Fiat, allowExpired: boolean): Promise<Price> {
    const fromPrice = await this.getPriceFor(from);
    const toPrice = await this.getPriceFor(to);

    if (fromPrice.target !== toPrice.target)
      throw new Error(`Price reference mismatch: ${this.getItemString(from)} -> ${this.getItemString(to)}`);

    const price = Price.join(fromPrice, toPrice.invert());

    if (!price.isValid && !allowExpired)
      throw new Error(`No valid price found: ${this.getItemString(from)} -> ${this.getItemString(to)}`);

    return price;
  }

  // --- HELPER METHODS --- //
  private async getPriceFor(item: Asset | Fiat): Promise<Price> {
    let rule = await this.getRuleFor(item);
    if (!rule) return Price.create(item.name, item.name, 1);

    const referencePrice = await this.getPriceFor(rule.reference);

    if (!rule.isPriceValid) {
      rule = await this.updatePriceFor(rule);
    }

    return Price.join(rule.price, referencePrice);
  }

  private async getRuleFor(item: Asset | Fiat): Promise<PriceRule | undefined> {
    const query = this.priceRuleRepo.createQueryBuilder('rule');
    this.isFiat(item) ? query.innerJoin('rule.fiats', 'item') : query.innerJoin('rule.assets', 'item');

    return query.innerJoinAndSelect('rule.reference', 'reference').where('item.id = :id', { id: item.id }).getOne();
  }

  private async updatePriceFor(rule: PriceRule): Promise<PriceRule> {
    const price = await this.getRulePrice(rule);

    if ((await this.isPriceValid(price, rule.check1)) && (await this.isPriceValid(price, rule.check2))) {
      rule.currentPrice = price.price;
      return this.priceRuleRepo.save(rule);
    }

    return rule;
  }

  private async getRulePrice(rule: Rule): Promise<Price> {
    return this.providerMap[rule.source].getPrice(rule.assetName, rule.referenceName);
  }

  private async isPriceValid(price: Price, rule?: Rule): Promise<boolean> {
    if (!rule) return true;

    const rulePrice = await this.getRulePrice(rule);
    const difference = Math.abs(rulePrice.price - price.price) / price.price;

    if (difference > rule.limit) {
      const message = `${price.source} to ${price.target} has ${Util.toPercent(
        difference,
      )} price mismatch (limit is ${Util.toPercent(rule.limit)})`;

      this.logger.error(message);
      await this.notificationService.sendMail({
        type: MailType.ERROR_MONITORING,
        input: { subject: 'Price Mismatch', errors: [message] },
        metadata: {
          context: MailContext.PRICING,
          correlationId: `PriceMismatch&${rule.assetName}&${rule.referenceName}`,
        },
        options: {
          debounce: 1800000,
        },
      });

      return false;
    }

    return true;
  }

  private isFiat(item: Asset | Fiat): item is Fiat {
    return item instanceof Fiat;
  }

  private getItemString(item: Asset | Fiat): string {
    return `${this.isFiat(item) ? 'fiat' : 'asset'} ${item.id}`;
  }
}
