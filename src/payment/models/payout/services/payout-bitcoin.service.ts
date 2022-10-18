import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/blockchain/ain/node/node.service';
import { BtcFeeService } from 'src/blockchain/ain/services/btc-fee.service';
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

  async checkPayoutCompletion(_context: any, payoutTxId: string): Promise<boolean> {
    const transaction = await this.#client.getTx(payoutTxId);

    return transaction && transaction.blockhash && transaction.confirmations > 0;
  }
}
