import { BigNumber } from 'ethers';
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

  async getCurrentGasForCoinTransaction(): Promise<number> {
    const gasPrice = await this.#client.getGasPrice();
    const gasLimit = this.#client.sendCoinGasLimit;
    const gasInGwei = BigNumber.from(+gasPrice * gasLimit);

    return this.#client.convertToEthLikeDenomination(gasInGwei, 'gwei');
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    const gasInGwei = await this.#client.getTokenGasLimit(token);

    return this.#client.convertToEthLikeDenomination(gasInGwei, 'gwei');
  }
}
