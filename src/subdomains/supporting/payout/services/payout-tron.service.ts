import { Injectable } from '@nestjs/common';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';

@Injectable()
export class PayoutTronService {
  constructor(private readonly tronService: TronService) {}

  async sendNativeCoin(address: string, amount: number): Promise<string> {
    try {
      return await this.tronService.sendNativeCoinFromDex(address, amount);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async sendToken(address: string, token: Asset, amount: number): Promise<string> {
    try {
      return await this.tronService.sendTokenFromDex(address, token, amount);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
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
