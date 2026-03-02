import { Injectable } from '@nestjs/common';
import { IcpTransferQueryResult } from 'src/integration/blockchain/icp/dto/icp.dto';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayInInternetComputerService {
  constructor(private readonly internetComputerService: InternetComputerService) {}

  getWalletAddress(): string {
    return this.internetComputerService.getWalletAddress();
  }

  async getBlockHeight(): Promise<number> {
    return this.internetComputerService.getBlockHeight();
  }

  async getTransfers(start: number, count: number): Promise<IcpTransferQueryResult> {
    return this.internetComputerService.getTransfers(start, count);
  }

  async getIcrcBlockHeight(canisterId: string): Promise<number> {
    return this.internetComputerService.getIcrcBlockHeight(canisterId);
  }

  async getIcrcTransfers(
    canisterId: string,
    decimals: number,
    start: number,
    count: number,
  ): Promise<IcpTransferQueryResult> {
    return this.internetComputerService.getIcrcTransfers(canisterId, decimals, start, count);
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.internetComputerService.getNativeCoinBalanceForAddress(address);
  }

  async getTokenBalance(asset: Asset, address: string): Promise<number> {
    return this.internetComputerService.getTokenBalance(asset, address);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.internetComputerService.getCurrentGasCostForCoinTransaction();
  }

  async sendNativeCoinFromDepositWallet(accountIndex: number, toAddress: string, amount: number): Promise<string> {
    return this.internetComputerService.sendNativeCoinFromDepositWallet(accountIndex, toAddress, amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    return this.internetComputerService.getCurrentGasCostForTokenTransaction(token);
  }

  async sendTokenFromDepositWallet(
    accountIndex: number,
    toAddress: string,
    token: Asset,
    amount: number,
  ): Promise<string> {
    return this.internetComputerService.sendTokenFromDepositWallet(accountIndex, toAddress, token, amount);
  }

  async checkTransactionCompletion(blockIndex: string, _minConfirmations?: number): Promise<boolean> {
    return this.internetComputerService.isTxComplete(blockIndex);
  }
}
