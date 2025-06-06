import { WalletAccount } from 'src/integration/blockchain/shared/evm/domain/wallet-account';
import { Direction, EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';
import { Asset } from 'src/shared/models/asset/asset.entity';

export abstract class PayInEvmService {
  #client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.#client = service.getDefaultClient();
  }

  async sendNativeCoin(account: WalletAccount, addressTo: string, amount: number): Promise<string> {
    return this.#client.sendNativeCoinFromAccount(account, addressTo, amount);
  }

  async sendNativeCoinFromDex(addressTo: string, amount: number): Promise<string> {
    return this.#client.sendNativeCoinFromDex(addressTo, amount);
  }

  async sendToken(account: WalletAccount, addressTo: string, tokenName: Asset, amount: number): Promise<string> {
    return this.#client.sendTokenFromAccount(account, addressTo, tokenName, amount);
  }

  async checkTransactionCompletion(txHash: string, minConfirmations: number): Promise<boolean> {
    return this.#client.isTxComplete(txHash, minConfirmations);
  }

  async getHistory(
    address: string,
    fromBlock: number,
    toBlock?: number,
  ): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]> {
    const allCoinTransactions = await this.#client.getNativeCoinTransactions(
      address,
      fromBlock,
      toBlock,
      Direction.INCOMING,
    );

    const allTokenTransactions = await this.#client.getERC20Transactions(
      address,
      fromBlock,
      toBlock,
      Direction.INCOMING,
    );

    return [allCoinTransactions, allTokenTransactions];
  }
}
