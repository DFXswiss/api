import { Injectable } from '@nestjs/common';
import { BtcClient, TestMempoolResult } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoin-based.service';

@Injectable()
export class PayoutBitcoinService extends PayoutBitcoinBasedService {
  #client: BtcClient;

  constructor(readonly nodeService: NodeService, private readonly feeService: BtcFeeService) {
    super();
    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.#client = client));
  }

  async isHealthy(): Promise<boolean> {
    try {
      return !!(await this.#client.getInfo());
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(_context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    const feeRate = await this.getCurrentFeeRate();
    return this.#client.sendMany(payout, feeRate);
  }

  async testMempoolAccept(hex: string): Promise<TestMempoolResult[]> {
    return this.#client.testMempoolAccept(hex);
  }

  async sendRawTransaction(hex: string): Promise<string> {
    return this.#client.sendRawTransaction(hex);
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.#client.getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete ? -transaction.fee : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFeeRate(): Promise<number> {
    return this.feeService.getRecommendedFeeRate().then((r) => 1.5 * r);
  }
}
