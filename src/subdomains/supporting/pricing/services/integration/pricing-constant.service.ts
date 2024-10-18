import { Injectable } from '@nestjs/common';
import { Price } from '../../domain/entities/price';
import { PricingProvider } from './pricing-provider';

@Injectable()
export class PricingConstantService extends PricingProvider {
  async getPrice(from: string, to: string, param: string): Promise<Price> {
    return Price.create(from, to, +param);
  }
}
