import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';

export interface IPayInEvmService {
  sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string>;
  sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string>;
  sendToken(account: WalletAccount, addressTo: string, tokenName: Asset, amount: number): Promise<string>;
  checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean>;
  getHistory(address: string, fromBlock: number, toBlock?: number): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]>;
  getCurrentBlockNumber(): Promise<number>;
}
