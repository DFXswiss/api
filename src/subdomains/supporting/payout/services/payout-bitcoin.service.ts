import { Injectable } from '@nestjs/common';
import { BtcClient, TestMempoolResult } from 'src/integration/blockchain/ain/node/btc-client';
import { BtcService, BtcType } from 'src/integration/blockchain/ain/node/btc.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { BitcoinSignedTransactionResponse } from 'src/integration/blockchain/shared/dto/signed-transaction-reponse.dto';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutBitcoinService extends PayoutBitcoinBasedService {
  private readonly client: BtcClient;

  constructor(readonly btcService: BtcService, private readonly feeService: BtcFeeService) {
    super();

    this.client = btcService.getDefaultClient(BtcType.BTC_OUTPUT);
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

  async testMempoolAccept(hex: string): Promise<TestMempoolResult[]> {
    return this.client.testMempoolAccept(hex);
  }

  async sendSignedTransaction(hex: string): Promise<BitcoinSignedTransactionResponse> {
    return this.client.sendSignedTransaction(hex);
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
