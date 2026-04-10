import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/utils/util';
import { BlockchainService } from '../../shared/util/blockchain.service';
import { StarknetTransactionDto } from '../dto/starknet.dto';
import { StarknetClient } from '../starknet-client';

@Injectable()
export class StarknetService extends BlockchainService {
  private readonly client: StarknetClient;

  constructor(private readonly http: HttpService) {
    super();

    this.client = new StarknetClient(this.http);
  }

  getDefaultClient(): StarknetClient {
    return this.client;
  }

  getWalletAddress(): string {
    return this.client.walletAddress;
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

  async getEthBalance(address?: string): Promise<number> {
    return this.client.getEthBalance(address);
  }

  async getTokenBalance(asset: Asset, address?: string): Promise<number> {
    return this.client.getTokenBalance(asset, address ?? this.client.walletAddress);
  }

  async sendNativeCoin(toAddress: string, amount: number): Promise<string> {
    return this.client.sendNativeCoin(toAddress, amount);
  }

  async sendEth(toAddress: string, amount: number): Promise<string> {
    return this.client.sendEth(toAddress, amount);
  }

  async sendToken(toAddress: string, token: Asset, amount: number): Promise<string> {
    return this.client.sendToken(toAddress, token, amount);
  }

  async isTxComplete(txHash: string, confirmations?: number): Promise<boolean> {
    return this.client.isTxComplete(txHash, confirmations);
  }

  async getTransaction(txHash: string): Promise<StarknetTransactionDto> {
    return this.client.getTransaction(txHash);
  }

  async getTxActualFee(txHash: string): Promise<number> {
    return this.client.getTxActualFee(txHash);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  getPaymentRequest(address: string, amount: number): string {
    return `starknet:${address}?amount=${Util.numberToFixedString(amount)}`;
  }
}
