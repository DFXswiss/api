import { Injectable } from '@nestjs/common';
import { BaseFeePriority } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutMoneroService extends PayoutBitcoinBasedService {
  private readonly client: MoneroClient;

  constructor(private moneroService: MoneroService) {
    super();

    this.client = moneroService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    return this.moneroService.isHealthy();
  }

  async getUnlockedBalance(): Promise<number> {
    return this.client.getUnlockedBalance();
  }

  async sendToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const transfer = await this.client.sendTransfers(payout);

    if (!transfer) {
      throw new Error(`Error while sending payment by Monero ${payout.map((p) => p.addressTo)}`);
    }

    return transfer.txid;
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const isComplete = await this.client.isTxComplete(payoutTxId);
    const payoutFee = isComplete ? (await this.client.getTransaction(payoutTxId).then((tx) => tx.txnFee)) ?? 0 : 0;

    return [isComplete, payoutFee];
  }

  async getEstimatedFee(): Promise<number> {
    const feeEstimate = await this.client.getFeeEstimate();
    return feeEstimate.fees[BaseFeePriority.slow];
  }
}
