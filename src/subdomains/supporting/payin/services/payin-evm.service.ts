import { Injectable } from '@nestjs/common';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { PayInEntry } from '../interfaces';

@Injectable()
export class PayInEvmService {
  #client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.#client = service.getDefaultClient();
  }

  async getTransactions(address: string, fromBlock: number): Promise<PayInEntry[]> {
    const coinTransactions = await this.#client.getNativeCoinTransactions(address, fromBlock);
    const tokenTransactions = await this.#client.getERC20Transactions(address, fromBlock);
  }
}
