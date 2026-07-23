import { Injectable } from '@nestjs/common';
import { MIN_FEE_RATE_SAT_VB } from 'src/integration/blockchain/bitcoin/services/bitcoin-based-fee.service';
import { FiroClient } from 'src/integration/blockchain/firo/firo-client';
import { FiroFeeService } from 'src/integration/blockchain/firo/services/firo-fee.service';
import { FiroService } from 'src/integration/blockchain/firo/services/firo.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBroadcastException } from '../exceptions/payout-broadcast.exception';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutFiroService extends PayoutBitcoinBasedService {
  private readonly client: FiroClient;

  constructor(
    firoService: FiroService,
    private readonly feeService: FiroFeeService,
  ) {
    super();

    this.client = firoService.getDefaultClient();
  }

  async isHealthy(): Promise<boolean> {
    try {
      return !!(await this.client.getInfo());
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const feeRate = await this.getCurrentFeeRate();

    try {
      return await this.client.sendMany(payout, feeRate);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async mintSpark(payout: PayoutGroup): Promise<string> {
    const recipients = payout.map((p) => ({ address: p.addressTo, amount: p.amount }));

    try {
      return await this.client.mintSpark(recipients);
    } catch (e) {
      if (e instanceof TxBroadcastError) throw new PayoutBroadcastException(e.message, { cause: e });
      throw e;
    }
  }

  async getPayoutCompletionData(_context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete ? -(transaction.fee ?? 0) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    return this.feeService.getSendFeeRate();
  }

  // Network's recommended (next-block) rate without the payout send margin (see getCurrentFeeRate),
  // used as the customer-facing minimum for inbound Open CryptoPay payments. Firo's estimatesmartfee
  // returns null on a quiet node (little traffic) — the normal state, where the relay floor is the
  // correct customer minimum (a Spark-spend to the transparent deposit address pays exactly that), so
  // degrade to it. A genuine node/RPC error still propagates (estimateSmartFee returns null only when
  // the node answers without an estimate; callNode rethrows connection errors), so a down node fails
  // closed like Bitcoin — the chain drops out of the fee cache rather than being advertised at 1.
  async getRecommendedFeeRate(): Promise<number> {
    return (await this.client.estimateSmartFee(1)) ?? MIN_FEE_RATE_SAT_VB;
  }
}
