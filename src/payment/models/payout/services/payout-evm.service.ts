import { EvmClient } from 'src/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

export abstract class PayoutEvmService {
  #client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.#client = service.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.#client.sendNativeCoin(address, amount);
  }

  async sendToken(address: string, tokenName: Asset, amount: number): Promise<string> {
    return this.#client.sendToken(address, tokenName, amount);
  }

  async checkPayoutCompletion(txHash: string): Promise<boolean> {
    return this.#client.isTxComplete(txHash);
  }
}
