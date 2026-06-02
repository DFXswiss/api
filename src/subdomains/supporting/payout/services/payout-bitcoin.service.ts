import { Injectable } from '@nestjs/common';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { BitcoinNodeType, BitcoinService } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { Util } from 'src/shared/utils/util';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { InvalidPayoutAmountException } from '../exceptions/invalid-payout-amount.exception';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

// Bitcoin Core's send/sendmany RPC parses amount fields with ParseFixedPoint(decimals=8)
// and fee_rate with decimals=3. Values with more precision (e.g. 0.30000000000000004
// from JS floating-point arithmetic) are rejected with "Invalid amount" (error code -3).
const BTC_AMOUNT_DECIMALS = 8;
const BTC_FEE_RATE_DECIMALS = 3;

@Injectable()
export class PayoutBitcoinService extends PayoutBitcoinBasedService {
  private readonly client: BitcoinClient;

  constructor(
    readonly bitcoinService: BitcoinService,
    private readonly feeService: BitcoinFeeService,
  ) {
    super();

    this.client = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_OUTPUT);
  }

  async isHealthy(): Promise<boolean> {
    try {
      return !!(await this.client.getInfo());
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const sanitizedPayout = this.sanitizePayoutAmounts(payout);
    const feeRate = Util.round(await this.getCurrentFeeRate(), BTC_FEE_RATE_DECIMALS);

    return this.client.sendMany(sanitizedPayout, feeRate);
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTx(payoutTxId);

    const isComplete = transaction != null;
    // fee is negative in Bitcoin Core for outgoing transactions, so we negate it
    // Safeguard: if fee is undefined (should not happen for payout txs), default to 0
    const payoutFee = isComplete ? -(transaction.fee ?? 0) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    return this.feeService.getSendFeeRate();
  }

  // Quantize each amount to 8 decimals before serializing to the RPC. Even though
  // BitcoinBasedStrategy.aggregatePayout already rounds once, downstream fee
  // adjustments and fixRoundingMismatch can re-introduce float artifacts. Reject
  // NaN, infinite or non-positive amounts here so a bad input fails fast with a
  // structured error instead of an opaque "Invalid amount" from the RPC.
  private sanitizePayoutAmounts(payout: PayoutGroup): PayoutGroup {
    return payout.map(({ addressTo, amount }) => {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new InvalidPayoutAmountException(`Invalid BTC payout amount for ${addressTo}: ${amount}`);
      }

      return { addressTo, amount: Util.round(amount, BTC_AMOUNT_DECIMALS) };
    });
  }
}
