import { Injectable } from '@nestjs/common';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class PayInSolanaService {
  private readonly logger = new DfxLogger(PayInSolanaService);

  constructor(private readonly solanaService: SolanaService) {}

  getWalletAddress() {
    return this.solanaService.getWalletAddress();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.solanaService.getNativeCoinBalanceForAddress(address);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.solanaService.getCurrentGasCostForCoinTransaction();
  }

  async sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string> {
    return this.solanaService.sendNativeCoinFromAccount(account, addressTo, amount);
  }

  async sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string> {
    return this.solanaService.sendNativeCoinFromDex(addressTo, amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    return this.solanaService.getCurrentGasCostForTokenTransaction(token);
  }

  async getCreateTokenAccountFee(toAddress: string, token: Asset): Promise<number> {
    return this.solanaService.getCreateTokenAccountFee(toAddress, token);
  }

  async sendToken(account: WalletAccount, addressTo: string, token: Asset, amount: number): Promise<string> {
    return this.solanaService.sendTokenFromAccount(account, addressTo, token, amount);
  }

  async checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean> {
    return this.solanaService.isTxComplete(txHash, minConfirmations);
  }
}
