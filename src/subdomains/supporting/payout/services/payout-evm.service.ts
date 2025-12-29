import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { IPayoutEvmService } from './base/payout-evm.interface';

export class PayoutEvmService implements IPayoutEvmService {
  #client: EvmClient;

  constructor(protected readonly service: EvmService) {
    this.#client = service.getDefaultClient();
  }

  async sendNativeCoin(address: string, amount: number, nonce?: number): Promise<string> {
    return this.#client.sendNativeCoinFromDex(address, amount, nonce);
  }

  async sendToken(address: string, tokenName: Asset, amount: number, nonce?: number): Promise<string> {
    return this.#client.sendTokenFromDex(address, tokenName, amount, nonce);
  }

  async getPayoutCompletionData(txHash: string): Promise<[boolean, number]> {
    const isComplete = await this.#client.isTxComplete(txHash);
    const payoutFee = isComplete ? await this.#client.getTxActualFee(txHash) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.#client.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.#client.getCurrentGasCostForTokenTransaction(token);
  }

  async getTxNonce(txHash: string): Promise<number> {
    return this.#client.getTxNonce(txHash);
  }
}
