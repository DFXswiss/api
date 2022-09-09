import { RouteHistoryDto } from '../../route/dto/route-history.dto';

export enum HistoryTransactionType {
  BUY = 'Buy',
  SELL = 'Sell',
  CRYPTO = 'Crypto',
}

abstract class HistoryDtoBase {
  type: string;
  buyAmount: number;
  buyAsset: string;
  sellAmount: number;
  sellAsset: string;
  fee: number;
  feeAsset: string;
  exchange: string;
  tradeGroup: string;
  comment: string;
  txid: string;
  buyValueInEur: number;
  sellValueInEur: number;
}

export class HistoryDto extends HistoryDtoBase {
  date: Date;
}

export class CoinTrackingHistoryDto extends HistoryDtoBase {
  date: number;
}

export class SimplifiedHistoryDto extends RouteHistoryDto {
  type: HistoryTransactionType;
}
