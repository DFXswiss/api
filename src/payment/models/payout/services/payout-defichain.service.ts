import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { PayoutOrderContext } from '../entities/payout-order.entity';

export type PayoutGroup = { addressTo: string; amount: number }[];

@Injectable()
export class PayoutDeFiChainService {
  #outClient: DeFiClient;
  #intClient: DeFiClient;

  constructor(readonly nodeService: NodeService, private readonly whaleService: WhaleService) {
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.#outClient = client));
    nodeService.getConnectedNode(NodeType.INT).subscribe((client) => (this.#intClient = client));
  }

  async sendUtxoToMany(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.getClient(context).sendUtxoToMany(payout);
  }

  async sendTokenToMany(context: PayoutOrderContext, asset: string, payout: PayoutGroup): Promise<string> {
    return this.getClient(context).sendTokenToMany(this.getWallet(context), asset, payout);
  }

  async checkPayoutCompletion(context: PayoutOrderContext, payoutTxId: string): Promise<boolean> {
    const transaction = await this.getClient(context).getTx(payoutTxId);

    return transaction && transaction.blockhash && transaction.confirmations > 0;
  }

  async getUtxoForAddress(address: string): Promise<string> {
    return this.whaleService.getClient().getBalance(address);
  }

  getWallet(context: PayoutOrderContext): string {
    if (context === PayoutOrderContext.BUY_CRYPTO) return Config.node.outWalletAddress;
    if (context === PayoutOrderContext.STAKING_REWARD) return Config.node.intWalletAddress;
  }

  private getClient(context: PayoutOrderContext): DeFiClient {
    if (context === PayoutOrderContext.BUY_CRYPTO) return this.#outClient;
    if (context === PayoutOrderContext.STAKING_REWARD) return this.#intClient;
  }
}
