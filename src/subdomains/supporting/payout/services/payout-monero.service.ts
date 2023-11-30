import { Injectable } from '@nestjs/common';
import { BaseFeePriority, GetTransactionResultDto } from 'src/integration/blockchain/monero/dto/monero.dto';
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

  async sendTransfer(address: string, amount: number): Promise<string> {
    const transfer = await this.client.transfer(address, amount);

    if (!transfer) {
      throw new Error(`Error while sending payment by Monero ${address}`);
    }

    return transfer.tx_hash;
  }

  async getPayoutCompletionData(payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTransaction(payoutTxId, true);

    const isComplete = MoneroHelper.isTransactionComplete(transaction);
    const payoutFee = isComplete ? this.getTransactionFee(transaction) : 0;

    return [isComplete, payoutFee];
  }

  private getTransactionFee(transactionResult: GetTransactionResultDto): number {
    try {
      const txs = JSON.parse(transactionResult.txs_as_json);
      return Array.isArray(txs) ? MoneroHelper.auToXmr(txs[0].txnFee) : 0;
    } catch {
      return 0;
    }
  }

  async getEstimatedFee(): Promise<number> {
    const feeEstimate = await this.client.getFeeEstimate();
    return feeEstimate.fees[BaseFeePriority.fastest];
  }
}
