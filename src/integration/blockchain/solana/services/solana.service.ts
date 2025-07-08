import { Injectable } from '@nestjs/common';
import * as bs58 from 'bs58';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import nacl from 'tweetnacl';
import { WalletAccount } from '../../shared/evm/domain/wallet-account';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { SolanaTransactionDto } from '../dto/solana.dto';
import { SolanaClient } from '../solana-client';

@Injectable()
export class SolanaService extends BlockchainService {
  private readonly client: SolanaClient;

  constructor(private readonly http: HttpService) {
    super();

    this.client = new SolanaClient(this.http);
  }

  getDefaultClient(): SolanaClient {
    return this.client;
  }

  getWalletAddress(): string {
    return this.client.getWalletAddress();
  }

  async getAllTokenAddresses(): Promise<string[]> {
    const walletAddress = this.client.getWalletAddress();
    return this.client.getAllTokens(walletAddress).then((t) => t.map((t) => t.address));
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    return nacl.sign.detached.verify(Util.stringToUint8(message, 'utf8'), bs58.decode(signature), bs58.decode(address));
  }

  getPaymentRequest(address: string, amount: number): string {
    return `solana:${address}?amount=${Util.numberToFixedString(amount)}`;
  }

  async getBlockHeight(): Promise<number> {
    return this.client.getBlockHeight();
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.client.getNativeCoinBalance();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.client.getNativeCoinBalanceForAddress(address);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    return this.client.getTokenBalance(asset, address ?? this.client.getWalletAddress());
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number) {
    return this.client.sendNativeCoinFromAccount(account, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(toAddress, amount);
  }

  async getCreateTokenAccountFee(toAddress: string, token: Asset): Promise<number> {
    return (await this.client.checkTokenAccount(toAddress, token.chainId))
      ? 0
      : Config.blockchain.solana.createTokenAccountFee;
  }

  async sendTokenFromAccount(account: WalletAccount, toAddress: string, token: Asset, amount: number) {
    return this.client.sendTokenFromAccount(account, toAddress, token, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number) {
    return this.client.sendTokenFromDex(toAddress, token, amount);
  }

  async isTxComplete(txHash: string, confirmations?: number): Promise<boolean> {
    return this.client.isTxComplete(txHash, confirmations);
  }

  async getTransaction(txHash: string): Promise<SolanaTransactionDto> {
    return this.client.getTransaction(txHash);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }
}
