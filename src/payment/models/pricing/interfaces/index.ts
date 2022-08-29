import { Price } from '../../exchange/dto/price.dto';

export interface PriceRequest {
  from: string;
  to: string;
  options?: PriceRequestOptions;
}

export interface PriceRequestOptions {
  includeReversePrice?: boolean;
}

export interface PriceResult {
  path: PricePathResult;
  price: Price;
  reversePath?: PricePathResult;
  reversePrice?: Price;
}

export interface PricePathResult {
  [key: number]: PriceStepResult;
}

export interface PriceStepResult {
  price: Price;
  vendor: PriceVendorName;
  timestamp: Date;
}

export type PriceVendorName = string;

export interface PriceVendor {
  name: PriceVendorName;
  getPrice(from: string, to: string): Promise<Price>;
}
