import { Price } from '../../../../integration/exchange/dto/price.dto';
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
  provider: PriceProviderName;
  timestamp: Date;
}

export type PriceProviderName = string;

export interface PriceProvider {
  name: PriceProviderName;
  getPrice(from: string, to: string): Promise<Price>;
}
