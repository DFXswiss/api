export class TransactionDto {
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
  date: string;
  txid: string;
  buyValueInEur: number;
  sellValueInEur: number;
}
