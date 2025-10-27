import { Injectable } from '@nestjs/common';
import { Price, PriceStep } from '../../domain/entities/price';
import { PriceRule } from '../../domain/entities/price-rule.entity';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingConstantService extends PricingProvider {
  async getPrice(from: string, to: string, param: string): Promise<Price> {
    return Price.create(from, to, +param);
  }

  getPriceStep(rule: PriceRule): PriceStep {
    return PriceStep.create(
      rule.rule.name ?? rule.rule.source,
      rule.from,
      rule.to,
      rule.currentPrice,
      rule.priceTimestamp,
    );
  }
}
