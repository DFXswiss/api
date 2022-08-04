import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Config } from 'src/config/config';

export type PayoutGroup = { addressTo: string; amount: number }[];

@Injectable()
export class PayoutChainService {
  #outClient: DeFiClient;

  constructor(readonly nodeService: NodeService, private readonly whaleService: WhaleService) {
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.#outClient = client));
  }

  async sendUtxoToMany(payout: PayoutGroup): Promise<string> {
    return this.#outClient.sendUtxoToMany(payout);
  }

  async sendTokenToMany(asset: string, payout: PayoutGroup): Promise<string> {
    return this.#outClient.sendTokenToMany(Config.node.outWalletAddress, asset, payout);
  }

  async getUtxoForAddress(address: string): Promise<string> {
    return this.whaleService.getClient().getBalance(address);
  }

  async checkPayoutCompletion(payoutTxId: string): Promise<boolean> {
    const transaction = await this.#outClient.getTx(payoutTxId);

    return transaction && transaction.blockhash && transaction.confirmations > 0;
  }
}
