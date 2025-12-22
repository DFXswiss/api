import { Injectable } from '@nestjs/common';
import { CardanoService } from 'src/integration/blockchain/cardano/services/cardano.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayoutCardanoService {
  constructor(private readonly cardanoService: CardanoService) {}

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.cardanoService.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number) {
    return this.cardanoService.sendTokenFromDex(address, token, amount);
  }

  async getPayoutCompletionData(txHash: string): Promise<[boolean, number]> {
    const isComplete = await this.cardanoService.isTxComplete(txHash);
    const payoutFee = isComplete ? await this.cardanoService.getTxActualFee(txHash) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.cardanoService.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.cardanoService.getCurrentGasCostForTokenTransaction(token);
  }
}
