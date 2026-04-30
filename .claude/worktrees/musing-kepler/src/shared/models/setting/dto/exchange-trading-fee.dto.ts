export class ExchangeTradingFeeDto {
  exchange: string;
  symbol: string;
  maker: number;
  taker: number;
  percentage: boolean;
  tierBased: boolean;
  updated: string;
}
