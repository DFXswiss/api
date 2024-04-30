import { Price } from '../entities/price';

export interface PricingProvider {
  getPrice(from: string, to: string, param?: string): Promise<Price>;
}
