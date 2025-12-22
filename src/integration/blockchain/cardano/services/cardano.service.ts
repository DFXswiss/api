import verifyCardanoSignature from '@cardano-foundation/cardano-verify-datasignature';
import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { SignedTransactionResponse } from '../../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../../shared/evm/domain/wallet-account';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { CardanoClient } from '../cardano-client';
import { CardanoTransactionDto } from '../dto/cardano.dto';

@Injectable()
export class CardanoService extends BlockchainService {
  private readonly client: CardanoClient;

  constructor(private readonly http: HttpService) {
    super();

    this.client = new CardanoClient(this.http);
  }

  getDefaultClient(): CardanoClient {
    return this.client;
  }

  getWalletAddress(): string {
    return this.client.walletAddress;
  }

  verifySignature(message: string, address: string, signature: string, key?: string): boolean {
    try {
      return verifyCardanoSignature(signature, key, message, address);
    } catch {
      return false;
    }
  }

  getPaymentRequest(address: string, amount: number): string {
    return `cardano:${address}?amount=${Util.numberToFixedString(amount)}`;
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
    return this.client.getTokenBalance(asset, address ?? this.client.walletAddress);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasCostForTokenTransaction(_token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(_token);
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number) {
    return this.client.sendNativeCoinFromAccount(account, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(toAddress, amount);
  }

  async sendTokenFromAccount(account: WalletAccount, toAddress: string, token: Asset, amount: number) {
    return this.client.sendTokenFromAccount(account, toAddress, token, amount);
  }

  async sendTokenFromDex(toAddress: string, token: Asset, amount: number) {
    return this.client.sendTokenFromDex(toAddress, token, amount);
  }

  async sendSignedTransaction(hex: string): Promise<SignedTransactionResponse> {
    return this.client.sendSignedTransaction(hex);
  }

  async isTxComplete(txHash: string, confirmations?: number): Promise<boolean> {
    return this.client.isTxComplete(txHash, confirmations);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }

  async getTransaction(txHash: string): Promise<CardanoTransactionDto> {
    return this.client.getTransaction(txHash);
  }

  async getHistory(limit: number): Promise<CardanoTransactionDto[]> {
    return this.client.getHistory(limit);
  }

  async getHistoryForAddress(address: string, limit: number): Promise<CardanoTransactionDto[]> {
    return this.client.getHistoryForAddress(address, limit);
  }
}
