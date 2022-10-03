import { EvmClient } from 'src/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/blockchain/shared/evm/evm.service';

export abstract class PayoutEvmService {
  #client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.#client = service.getDefaultClient();
  }

  async send(address: string, amount: number): Promise<string> {
    return this.#client.sendNativeCrypto(address, amount);
  }

  async checkPayoutCompletion(txHash: string): Promise<boolean> {
    return this.#client.isTxComplete(txHash);
  }
}
