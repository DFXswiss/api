import { Injectable } from '@nestjs/common';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutZanoService extends PayoutBitcoinBasedService {
  constructor(private readonly zanoService: ZanoService) {
    super();
  }

  async isHealthy(): Promise<boolean> {
    return this.zanoService.isHealthy();
  }

  async getUnlockedCoinBalance(): Promise<number> {
    return this.zanoService.getUnlockedCoinBalance();
  }

  async getUnlockedTokenBalance(token: Asset): Promise<number> {
    return this.zanoService.getUnlockedTokenBalance(token);
  }

  async sendCoins(payout: PayoutGroup): Promise<string> {
    try {
      return await this.zanoService.sendCoins(payout).then((r) => r.txId);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async sendTokens(payout: PayoutGroup, token: Asset): Promise<string> {
    try {
      return await this.zanoService.sendTokens(payout, token).then((r) => r.txId);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.zanoService.getTransaction(payoutTxId);

    const isComplete = await this.zanoService.isTxComplete(payoutTxId);
    const payoutFee = isComplete ? (transaction.fee ?? 0) : 0;

    return [isComplete, payoutFee];
  }

  getEstimatedFee(): number {
    return this.zanoService.getFeeEstimate();
  }
}
