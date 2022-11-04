import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/integration/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/integration/blockchain/ain/services/btc-fee.service';
import { Util } from 'src/shared/utils/util';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutGroup, PayoutJellyfishService } from './base/payout-jellyfish.service';

@Injectable()
export class PayoutBitcoinService extends PayoutJellyfishService {
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
    const feeRate = await this.feeService.getRecommendedFeeRate();
    return this.#client.sendMany(payout, feeRate);
  }

  async getPayoutCompletionData(_context: any, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.#client.getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete ? Util.round(-transaction.fee / 100000000, 8) : 0;

    return [isComplete, payoutFee];
  }

  async getCurrentFastestFeeRate(): Promise<number> {
    return this.feeService.getRecommendedFeeRate();
  }
}
