import { Currency } from '@uniswap/sdk-core';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainTokenBalance } from '../dto/blockchain-token-balance.dto';
import { SignedTransactionResponse } from '../dto/signed-transaction-reponse.dto';

export abstract class BlockchainClient {
  abstract getNativeCoinBalance(): Promise<number>;
  abstract getNativeCoinBalanceForAddress(address: string): Promise<number>;
  abstract getTokenBalance(asset: Asset, address?: string): Promise<number>;
  abstract getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]>;
  abstract isTxComplete(txHash: string, confirmations?: number): Promise<boolean>;
  abstract getToken(asset: Asset): Promise<Currency>;
  abstract sendSignedTransaction(tx: string): Promise<SignedTransactionResponse>;
}
