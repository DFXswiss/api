import { Injectable } from '@nestjs/common';
import { CardanoTransactionDto } from 'src/integration/blockchain/cardano/dto/cardano.dto';
import { CardanoService } from 'src/integration/blockchain/cardano/services/cardano.service';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainAddress } from 'src/shared/models/blockchain-address';
import { RegisterStrategyRegistry } from '../strategies/register/impl/base/register.strategy-registry';
import { CardanoStrategy } from '../strategies/register/impl/cardano.strategy';

@Injectable()
export class PayInCardanoService {
  constructor(
    private readonly cardanoService: CardanoService,
    private readonly registerStrategyRegistry: RegisterStrategyRegistry,
  ) {}

  getWalletAddress() {
    return this.cardanoService.getWalletAddress();
  }

  async getNativeCoinBalanceForAddress(address: string): Promise<number> {
    return this.cardanoService.getNativeCoinBalanceForAddress(address);
  }

  async getCurrentGasCostForCoinTransaction(): Promise<number> {
    return this.cardanoService.getCurrentGasCostForCoinTransaction();
  }

  async sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string> {
    return this.cardanoService.sendNativeCoinFromAccount(account, addressTo, amount);
  }

  async sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string> {
    return this.cardanoService.sendNativeCoinFromDex(addressTo, amount);
  }

  async getCurrentGasCostForTokenTransaction(token: Asset): Promise<number> {
    return this.cardanoService.getCurrentGasCostForTokenTransaction(token);
  }

  async sendToken(account: WalletAccount, addressTo: string, token: Asset, amount: number): Promise<string> {
    return this.cardanoService.sendTokenFromAccount(account, addressTo, token, amount);
  }

  async checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean> {
    return this.cardanoService.isTxComplete(txHash, minConfirmations);
  }

  async getHistoryForAddress(address: string, limit: number): Promise<CardanoTransactionDto[]> {
    return this.cardanoService.getHistoryForAddress(address, limit);
  }

  async pollAddress(address: BlockchainAddress): Promise<void> {
    const registerStrategy = this.registerStrategyRegistry.get(address.blockchain) as CardanoStrategy;
    return registerStrategy.pollAddress(address);
  }
}
