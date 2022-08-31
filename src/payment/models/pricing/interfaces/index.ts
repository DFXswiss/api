import { Price } from '../../exchange/dto/price.dto';

export interface PriceRequest {
  from: string;
  to: string;
}

export interface PriceResult {
  path: PricePathResult;
  price: Price;
}

export interface PricePathResult {
  [key: number]: PriceStepResult;
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
