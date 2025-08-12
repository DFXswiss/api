import { Price, PriceStep } from '../../domain/entities/price';
import { PriceRule } from '../../domain/entities/price-rule.entity';

export abstract class PricingProvider {
  abstract getPrice(from: string, to: string, param?: string): Promise<Price>;

  getPriceStep(rule: PriceRule): PriceStep {
    return PriceStep.create(rule.rule.source, rule.from, rule.to, rule.currentPrice, rule.priceTimestamp);
  }
}
