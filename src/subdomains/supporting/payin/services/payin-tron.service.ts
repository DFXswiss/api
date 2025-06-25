import { Injectable } from '@nestjs/common';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayInTronService {
  constructor(private readonly tronService: TronService) {}

  getWalletAddress() {
    return this.tronService.getWalletAddress();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.tronService.getNativeCoinBalanceForAddress(address);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.tronService.getCurrentGasCostForCoinTransaction();
  }

  async sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string> {
    return this.tronService.sendNativeCoinFromAccount(account, addressTo, amount);
  }

  async sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string> {
    return this.tronService.sendNativeCoinFromDex(addressTo, amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset, address: string): Promise<number> {
    return this.tronService.getCurrentGasCostForTokenTransaction(token, address);
  }

  async sendToken(account: WalletAccount, addressTo: string, token: Asset, amount: number): Promise<string> {
    return this.tronService.sendTokenFromAccount(account, addressTo, token, amount);
  }

  async checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean> {
    return this.tronService.isTxComplete(txHash, minConfirmations);
  }
}
