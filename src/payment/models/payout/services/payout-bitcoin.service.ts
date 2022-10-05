import { Injectable } from '@nestjs/common';
import { BtcClient } from 'src/blockchain/ain/node/btc-client';
import { NodeService, NodeType } from 'src/blockchain/ain/node/node.service';

export type PayoutGroup = { addressTo: string; amount: number }[];

@Injectable()
export class PayoutBitcoinService {
  #client: BtcClient;

  constructor(readonly nodeService: NodeService) {
    nodeService.getConnectedNode(NodeType.BTC_OUTPUT).subscribe((client) => (this.#client = client));
  }

  async isHealthy(): Promise<boolean> {
    try {
      return !!(await this.#client.getInfo());
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(payout: PayoutGroup): Promise<string> {
    return this.#client.sendUtxoToMany(payout);
  }

  async checkPayoutCompletion(payoutTxId: string): Promise<boolean> {
    const transaction = await this.#client.getTx(payoutTxId);

    return transaction && transaction.blockhash && transaction.confirmations > 0;
  }
}
