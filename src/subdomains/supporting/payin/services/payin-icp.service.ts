import { Injectable } from '@nestjs/common';
import { IcpTransfer, IcpTransferQueryResult } from 'src/integration/blockchain/icp/dto/icp.dto';
import { InternetComputerClient } from 'src/integration/blockchain/icp/icp-client';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayInInternetComputerService {
  private readonly client: InternetComputerClient;

  constructor(internetComputerService: InternetComputerService) {
    this.client = internetComputerService.getDefaultClient();
  }

  getWalletAddress(): string {
    return this.client.walletAddress;
  }

  async getBlockHeight(): Promise<number> {
    return this.client.getBlockHeight();
  }

  async getTransfers(start: number, count: number): Promise<IcpTransferQueryResult> {
    return this.client.getTransfers(start, count);
  }

  async getNativeTransfersForAddress(
    accountIdentifier: string,
    maxBlock?: number,
    limit?: number,
  ): Promise<IcpTransfer[]> {
    return this.client.getNativeTransfersForAddress(accountIdentifier, maxBlock, limit);
  }

  async getIcrcBlockHeight(canisterId: string): Promise<number> {
    return this.client.getIcrcBlockHeight(canisterId);
  }

  async getIcrcTransfers(
    canisterId: string,
    decimals: number,
    start: number,
    count: number,
  ): Promise<IcpTransferQueryResult> {
    return this.client.getIcrcTransfers(canisterId, decimals, start, count);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.client.getNativeCoinBalanceForAddress(address);
  }

  async getTokenBalance(asset: Asset, address: string): Promise<number> {
    return this.client.getTokenBalance(asset, address);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async sendNativeCoinFromDepositWallet(accountIndex: number, toAddress: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDepositWallet(accountIndex, toAddress, amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }

  async sendTokenFromDepositWallet(
    accountIndex: number,
    toAddress: string,
    token: Asset,
    amount: number,
  ): Promise<string> {
    return this.client.sendTokenFromDepositWallet(accountIndex, toAddress, token, amount);
  }

  async checkTransactionCompletion(blockIndex: string, _minConfirmations?: number): Promise<boolean> {
    return this.client.isTxComplete(blockIndex);
  }
}
