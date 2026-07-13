import { Injectable } from '@nestjs/common';
import { CardanoService } from 'src/integration/blockchain/cardano/services/cardano.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';

@Injectable()
export class PayoutCardanoService {
  constructor(private readonly cardanoService: CardanoService) {}

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    try {
      return await this.cardanoService.sendNativeCoinFromDex(address, amount);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    try {
      return await this.cardanoService.sendTokenFromDex(address, token, amount);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
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
