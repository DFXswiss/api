import { Price } from '../entities/price';
import { PriceRequestContext } from '../enums';

export interface PriceRequest {
  context: PriceRequestContext;
  correlationId: string;
  from: string;
  to: string;
}

export interface PriceResult {
  path: PriceStepResult[];
  price: Price;
}

export interface PriceStepResult {
  price: Price;
  provider: PricingProviderName;
  timestamp: Date;
}

export type PricingProviderName = string;

export interface PricingProvider {
  name: PricingProviderName;
  getPrice(from: string, to: string): Promise<Price>;
}
