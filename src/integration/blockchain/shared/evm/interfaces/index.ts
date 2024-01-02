import { Asset } from 'src/shared/models/asset/asset.entity';

export interface EvmCoinHistoryEntry {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
}

export interface EvmTokenHistoryEntry {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  contractAddress: string;
  to: string;
  value: string;
  tokenName: string;
  tokenDecimal: string;
}

export interface L2BridgeEvmClient {
  depositCoinOnDex(amount: number): Promise<string>;
  withdrawCoinOnDex(amount: number): Promise<string>;

  approveToken(l1Token: Asset, l2Token: Asset): Promise<string>;
  depositTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string>;
  withdrawTokenOnDex(l1Token: Asset, l2Token: Asset, amount: number): Promise<string>;

  checkL2BridgeCompletion(l1TxId: string, asset: Asset): Promise<boolean>;
  checkL1BridgeCompletion(l2TxId: string, asset: Asset): Promise<boolean>;
}
