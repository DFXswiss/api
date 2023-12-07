import { Injectable } from '@nestjs/common';
import { BaseFeePriority } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';

@Injectable()
export class PayoutMoneroService {
  private readonly client: MoneroClient;

  constructor(private moneroService: MoneroService) {
    this.client = moneroService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    return this.moneroService.isHealthy();
  }

  async getUnlockedBalance(): Promise<number> {
    return this.client.getBalance().then((b) => b.unlocked_balance);
  }

  async sendTransfer(address: string, amount: number): Promise<string> {
    const transfer = await this.client.sendTransfer(address, amount);

    if (!transfer) {
      throw new Error(`Error while sending payment by Monero ${address}`);
    }

    return transfer.txid;
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTransaction(payoutTxId);

    const isComplete = MoneroHelper.isTransactionComplete(transaction);
    const payoutFee = isComplete ? transaction.txnFee ?? 0 : 0;

    return [isComplete, payoutFee];
  }

  async getEstimatedFee(): Promise<number> {
    const feeEstimate = await this.client.getFeeEstimate();
    return feeEstimate.fees[BaseFeePriority.fastest];
  }
}
