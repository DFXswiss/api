import { BigNumber } from 'ethers';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Util } from 'src/shared/utils/util';

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

  async getPayoutCompletionData(txHash: string): Promise<[boolean, number]> {
    const isComplete = await this.#client.isTxComplete(txHash);
    const payoutFee = isComplete ? await this.#client.getTxActualFee(txHash) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    const gasPrice = await this.#client.getGasPrice();
    const gasLimit = this.#client.sendCoinGasLimit;
    const gasInWei = BigNumber.from(+gasPrice * gasLimit);

    return Util.round(this.#client.convertToEthLikeDenomination(gasInWei), 8);
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    const gasPrice = await this.#client.getGasPrice();
    const gasLimit = await this.#client.getTokenGasLimit(token);
    const gasInWei = BigNumber.from(+gasPrice * +gasLimit);

    return Util.round(this.#client.convertToEthLikeDenomination(gasInWei), 8);
  }
}
