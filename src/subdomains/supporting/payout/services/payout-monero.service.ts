import { Injectable } from '@nestjs/common';
import { BaseFeePriority, MoneroSignedTxDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroHelper } from 'src/integration/blockchain/monero/monero-helper';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutMoneroService extends PayoutBitcoinBasedService {
  private readonly client: MoneroClient;

  constructor(private readonly moneroService: MoneroService) {
    super();

    this.client = moneroService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    return this.moneroService.isHealthy();
  }

  async getUnlockedBalance(): Promise<number> {
    return this.client.getUnlockedBalance();
  }

  // Phase one of the split (#4673): build and sign without relaying. Failures here are provably
  // pre-broadcast - MoneroClient#buildTransfer sets out why - and deliberately do NOT become a
  // PayoutBroadcastException: they roll back for auto-retry like the -17/-37 pre-funding codes.
  async buildTransfer(payout: PayoutGroup): Promise<MoneroSignedTxDto> {
    const signedTx = await this.client.buildTransfer(payout);

    if (!signedTx) {
      throw new Error(`Error while building Monero payment ${payout.map((p) => p.addressTo)}`);
    }

    return signedTx;
  }

  // Phase two: relay a transaction that is already built, signed and persisted. This is the only step
  // that can leave a transaction in flight, so it keeps the fail-closed wrapping - but it is ambiguous
  // for this call alone, since the caller already holds the transaction's final id.
  async relayTransfer(metadata: string): Promise<string> {
    try {
      return await this.client.relayTransfer(metadata);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async isTxKnown(txId: string): Promise<boolean> {
    return this.client.isTxKnown(txId);
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTransaction(payoutTxId);

    const isComplete = MoneroHelper.isTransactionComplete(transaction);
    const payoutFee = isComplete ? (transaction.txnFee ?? 0) : 0;

    return [isComplete, payoutFee];
  }

  async getEstimatedFee(): Promise<number> {
    const feeEstimate = await this.client.getFeeEstimate();
    return feeEstimate.fees[BaseFeePriority.slow];
  }
}
