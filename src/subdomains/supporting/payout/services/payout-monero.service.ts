import { Injectable } from '@nestjs/common';
import { BaseFeePriority, GetRelayTransactionResultDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutMoneroService extends PayoutBitcoinBasedService {
  private readonly moneroClient: MoneroClient;

  constructor(private readonly moneroService: MoneroService) {
    super();

    this.moneroClient = moneroService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    return this.moneroService.isHealthy();
  }

  async getUnlockedBalance(): Promise<number> {
    return this.moneroClient.getUnlockedBalance();
  }

  async sendToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const transfer = await this.moneroClient.sendTransfers(payout);

    if (!transfer) {
      throw new Error(`Error while sending payment by Monero ${payout.map((p) => p.addressTo)}`);
    }

    return transfer.txid;
  }

  async relayTransaction(hex: string): Promise<GetRelayTransactionResultDto> {
    return this.moneroClient.relayTransaction(hex);
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.moneroClient.getTransaction(payoutTxId);

    const isComplete = MoneroHelper.isTransactionComplete(transaction);
    const payoutFee = isComplete ? transaction.txnFee ?? 0 : 0;

    return [isComplete, payoutFee];
  }

  async getEstimatedFee(): Promise<number> {
    const feeEstimate = await this.moneroClient.getFeeEstimate();
    return feeEstimate.fees[BaseFeePriority.slow];
  }
}
