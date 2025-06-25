import { Injectable, OnModuleInit } from '@nestjs/common';
import { ApiVersion, Network as TatumNetwork, TatumSDK, Tron } from '@tatumio/tatum';
import { TronWalletProvider } from '@tatumio/tron-wallet-provider';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { TronWeb } from 'tronweb';
import { SignedTransactionResponse } from '../../shared/dto/signed-transaction-reponse.dto';
import { WalletAccount } from '../../shared/evm/domain/wallet-account';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { TronToken, TronTransactionDto } from '../dto/tron.dto';
import { TronClient } from '../tron-client';

@Injectable()
export class TronService extends BlockchainService implements OnModuleInit {
  private tatumSdk: Tron;

  private client: TronClient;

  constructor(private readonly http: HttpService) {
    super();
  }

  async onModuleInit() {
    this.tatumSdk = await TatumSDK.init<Tron>({
      version: ApiVersion.V3,
      network: TatumNetwork.TRON,
      apiKey: Config.blockchain.tron.tronApiKey,
      configureWalletProviders: [TronWalletProvider],
    });

    this.client = new TronClient(this.http, this.tatumSdk);
  }

  getDefaultClient(): TronClient {
    return this.client;
  }

  getWalletAddress(): string {
    return this.client.getWalletAddress();
  }

  async verifySignature(message: string, address: string, signature: string): Promise<boolean> {
    const tronWeb = new TronWeb({ fullHost: 'http://127.0.0.1' });

    const addressRecovered = await tronWeb.trx.verifyMessageV2(message, signature);

    return Util.equalsIgnoreCase(addressRecovered, address);
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

  async getCurrentGasCostForCoinTransaction(address?: string): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction(address);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset, address?: string): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token, address);
  }

  async sendNativeCoinFromAccount(account: WalletAccount, toAddress: string, amount: number) {
    return this.client.sendNativeCoinFromAccount(account, toAddress, amount);
  }

  async sendNativeCoinFromDex(toAddress: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(toAddress, amount);
  }

  async getToken(asset: Asset): Promise<TronToken> {
    return this.client.getToken(asset);
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

  async getTransaction(txHash: string): Promise<TronTransactionDto> {
    return this.client.getTransaction(txHash);
  }

  async getHistory(limit: number): Promise<TronTransactionDto[]> {
    return this.client.getHistory(limit);
  }

  async checkAccount(address: string): Promise<boolean> {
    return this.client.checkAccount(address);
  }
}
