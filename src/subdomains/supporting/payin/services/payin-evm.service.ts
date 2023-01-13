import { BigNumber } from 'ethers';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { EvmCoinHistoryEntry, EvmTokenHistoryEntry } from 'src/integration/blockchain/shared/evm/interfaces';

export abstract class PayInEvmService {
  #client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.#client = service.getDefaultClient();
  }

  async getHistory(address: string, fromBlock: number): Promise<[EvmCoinHistoryEntry[], EvmTokenHistoryEntry[]]> {
    const allCoinTransactions = await this.#client.getNativeCoinTransactions(address, fromBlock);
    const allTokenTransactions = await this.#client.getERC20Transactions(address, fromBlock);

    return [allCoinTransactions, allTokenTransactions];
  }

  convertToEthLikeDenomination(value: number, decimals?: number): number {
    return this.#client.convertToEthLikeDenomination(BigNumber.from(value.toString()), decimals);
  }
}
