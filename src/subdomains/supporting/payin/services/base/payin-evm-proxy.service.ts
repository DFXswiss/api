import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayInEvmFactory } from '../payin-evm.factory';
import { IPayInEvmService } from './payin-evm.interface';

export abstract class PayInEvmProxyService implements IPayInEvmService {
  protected abstract readonly blockchain: Blockchain;

  constructor(protected readonly factory: PayInEvmFactory) {}

  private get service() {
    return this.factory.getPayInService(this.blockchain);
  }

  async sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string> {
    return this.service.sendNativeCoin(account, addressTo, amount);
  }

  async sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string> {
    return this.service.sendNativeCoinFromDex(addressTo, amount);
  }

  async sendToken(account: WalletAccount, addressTo: string, tokenName: Asset, amount: number): Promise<string> {
    return this.service.sendToken(account, addressTo, tokenName, amount);
  }

  async checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean> {
    return this.service.checkTransactionCompletion(txHash, minConfirmations);
  }

  async getHistory(
    address: string,
    fromBlock: number,
    toBlock?: number,
  ): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]> {
    return this.service.getHistory(address, fromBlock, toBlock);
  }

  async getCurrentBlockNumber(): Promise<number> {
    return this.service.getCurrentBlockNumber();
  }
}
