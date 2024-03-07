import { TradingOrderStatus } from '../../enums';

export class TradingOrderOutputDto {
  status: TradingOrderStatus;
  tradingRuleId: number;
  price1: number;
  price2: number;
  priceImpact: number;
  assetInId: number;
  assetOutId: number;
  amountIn: number;
  txId: string;
  errorMessage: string;

  //*** HELPER METHODS ***//
  setErrorMessage(errorMessage: string): this {
    this.errorMessage = errorMessage;
    return this;
  }
}
