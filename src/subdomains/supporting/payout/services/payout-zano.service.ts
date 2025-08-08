import { Injectable } from '@nestjs/common';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutZanoService extends PayoutBitcoinBasedService {
  constructor(private readonly zanoService: ZanoService) {
    super();
  }

  async isHealthy(): Promise<boolean> {
    return this.zanoService.isHealthy();
  }

  async getUnlockedBalance(): Promise<number> {
    return this.zanoService.getUnlockedBalance();
  }

  async sendToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const transferResult = await this.zanoService.sendTransfers(payout);

    if (!transferResult) {
      throw new Error(`Error while sending payment by Zano ${payout.map((p) => p.addressTo)}`);
    }

    return transferResult.txId;
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.zanoService.getTransaction(payoutTxId);

    const isComplete = await this.zanoService.isTxComplete(payoutTxId);
    const payoutFee = isComplete ? transaction.fee ?? 0 : 0;

    return [isComplete, payoutFee];
  }

  getEstimatedFee(): number {
    return this.zanoService.getFeeEstimate();
  }
}
