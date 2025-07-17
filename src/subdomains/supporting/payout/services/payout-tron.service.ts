import { Injectable } from '@nestjs/common';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { Asset } from 'src/shared/models/asset/asset.entity';

@Injectable()
export class PayoutTronService {
  constructor(private readonly tronService: TronService) {}

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    return this.tronService.sendNativeCoinFromDex(address, amount);
  }

  async sendToken(address: string, token: Asset, amount: number) {
    return this.tronService.sendTokenFromDex(address, token, amount);
  }

  async getPayoutCompletionData(txHash: string): Promise<[boolean, number]> {
    const isComplete = await this.tronService.isTxComplete(txHash);
    const payoutFee = isComplete ? await this.tronService.getTxActualFee(txHash) : 0;

    return [isComplete, payoutFee];
  }
  async getCurrentGasForCoinTransaction(): Promise<number> {
    return this.tronService.getCurrentGasCostForCoinTransaction();
  }

  async getCurrentGasForTokenTransaction(token: Asset): Promise<number> {
    return this.tronService.getCurrentGasCostForTokenTransaction(token);
  }
}
