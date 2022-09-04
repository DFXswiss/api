import { EVMClient } from 'src/blockchain/shared/evm/evm-client';
import { EVMService } from 'src/blockchain/shared/evm/evm.service';

export abstract class PayoutEVMService {
  #client: EVMClient;

  constructor(protected readonly service: EVMService) {
    this.#client = service.getDefaultClient();
  }

  async send(address: string, amount: number): Promise<string> {
    return this.#client.send(address, amount);
  }

  async checkPayoutCompletion(txHash: string): Promise<boolean> {
    return this.#client.isTxComplete(txHash);
  }
}
