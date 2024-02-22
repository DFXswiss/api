import { Price } from '../entities/price';

export interface PricingProvider {
  getPrice(from: string, to: string): Promise<Price>;
}
