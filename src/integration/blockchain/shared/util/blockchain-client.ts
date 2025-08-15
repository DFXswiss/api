import { Currency } from '@uniswap/sdk-core';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SolanaToken } from '../../solana/dto/solana.dto';
import { TronToken } from '../../tron/dto/tron.dto';
import { BlockchainTokenBalance } from '../dto/blockchain-token-balance.dto';
import { SignedTransactionResponse } from '../dto/signed-transaction-reponse.dto';

export type BlockchainCurrency = Currency | SolanaToken | TronToken;

export abstract class BlockchainClient {
  abstract getWalletAddress(): string;
  abstract getNativeCoinBalance(): Promise<number>;
  abstract getNativeCoinBalanceForAddress(address: string): Promise<number>;
  abstract getTokenBalance(asset: Asset, address?: string): Promise<number>;
  abstract getTokenBalances(assets: Asset[], address?: string): Promise<BlockchainTokenBalance[]>;
  abstract isTxComplete(txHash: string, confirmations?: number): Promise<boolean>;
  abstract getToken(asset: Asset): Promise<BlockchainCurrency>;
  abstract sendSignedTransaction(tx: string): Promise<SignedTransactionResponse>;
}
