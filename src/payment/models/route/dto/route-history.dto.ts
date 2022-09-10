import { AmlCheck } from '../../buy-crypto/enums/aml-check.enum';

export enum HistoryTransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CRYPTO = 'Crypto',
}

export class RouteHistoryDto {
  inputAmount: number;
  inputAsset: string;
  outputAmount: number;
  outputAsset: string;
  txId: string;
  date: Date;
  amlCheck: AmlCheck;
  isComplete: boolean;
}

export class TypedRouteHistoryDto extends RouteHistoryDto {
  type: HistoryTransactionType;
}
