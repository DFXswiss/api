abstract class TransactionDtoBase {
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

export class TransactionDto extends TransactionDtoBase {
  date: Date;
}

export class CoinTrackingTransactionDto {
  date: number;
}
