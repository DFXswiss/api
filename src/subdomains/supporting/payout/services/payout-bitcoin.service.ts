import { Injectable } from '@nestjs/common';
import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinService, BitcoinType } from 'src/integration/blockchain/bitcoin/node/bitcoin.service';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutBitcoinService extends PayoutBitcoinBasedService {
  private readonly client: BitcoinClient;

  constructor(readonly bitcoinService: BitcoinService, private readonly feeService: BitcoinFeeService) {
    super();

    this.client = bitcoinService.getDefaultClient(BitcoinType.BTC_OUTPUT);
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
    return this.client.sendMany(payout, feeRate);
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.client.getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete ? -transaction.fee : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    return this.feeService.getRecommendedFeeRate().then((r) => 1.5 * r);
  }
}
