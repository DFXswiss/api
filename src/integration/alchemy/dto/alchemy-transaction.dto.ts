export interface AlchemyTransactionDto {
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  hash: string;
  rawContract: {
    rawValue: string;
    decimals: number;
    address: string;
  };
}
