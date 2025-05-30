import { Injectable } from '@nestjs/common';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { SolanaService } from 'src/integration/blockchain/solana/services/solana.service';
import { SolanaClient } from 'src/integration/blockchain/solana/solana-client';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';

@Injectable()
export class PayInSolanaService {
  private readonly logger = new DfxLogger(PayInSolanaService);

  private readonly client: SolanaClient;

  constructor(service: SolanaService) {
    this.client = service.getDefaultClient();
  }

  getWalletAddress() {
    return this.client.getWalletAddress();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.client.getNativeCoinBalanceForAddress(address);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.client.getCurrentGasCostForCoinTransaction();
  }

  async sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromAccount(account, addressTo, amount);
  }

  async sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string> {
    return this.client.sendNativeCoinFromDex(addressTo, amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    return this.client.getCurrentGasCostForTokenTransaction(token);
  }

  async sendToken(account: WalletAccount, addressTo: string, token: Asset, amount: number): Promise<string> {
    return this.client.sendTokenFromAccount(account, addressTo, token, amount);
  }

  async checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean> {
    return this.client.isTxComplete(txHash, minConfirmations);
  }
}
