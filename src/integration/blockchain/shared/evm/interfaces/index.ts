import { Asset } from 'src/shared/models/asset/asset.entity';

export interface EvmCoinHistoryEntry {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  transactionIndex: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  isError: string;
  txreceipt_status: string;
  input: string;
  contractAddress: string;
  cumulativeGasUsed: string;
  gasUsed: string;
  confirmations: string;
  methodId: string;
  functionName: string;
}

export interface EvmTokenHistoryEntry {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  from: string;
  contractAddress: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  transactionIndex: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  input: string;
  confirmations: string;
}

export interface L2BridgeEvmClient {
  depositCoinOnDex(amount: number): Promise<string>;
  withdrawCoinOnDex(amount: number): Promise<string>;

  approveTokenBridge(l1Token: Asset, l2Token: Asset): Promise<string>;
  depositTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string>;
  withdrawTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string>;

  checkL2BridgeCompletion(l1TxId: string, asset: Asset): Promise<boolean>;
  checkL1BridgeCompletion(l2TxId: string, asset: Asset): Promise<boolean>;
}
