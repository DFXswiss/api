import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { WhaleService } from 'src/integration/blockchain/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutGroup, PayoutJellyfishService } from './base/payout-jellyfish.service';

@Injectable()
export class PayoutDeFiChainService extends PayoutJellyfishService {
  #outClient: DeFiClient;
  #intClient: DeFiClient;

  constructor(readonly nodeService: NodeService, private readonly whaleService: WhaleService) {
    super();
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.#outClient = client));
    nodeService.getConnectedNode(NodeType.INT).subscribe((client) => (this.#intClient = client));
  }

  async isHealthy(context: PayoutOrderContext): Promise<boolean> {
    try {
      return !!(await this.getClient(context).getInfo());
    } catch {
      return false;
    }
  }

  async sendUtxoToMany(context: PayoutOrderContext, payout: PayoutGroup): Promise<string> {
    return this.getClient(context).sendUtxoToMany(payout);
  }

  async sendTokenToMany(context: PayoutOrderContext, payout: PayoutGroup, asset: string): Promise<string> {
    return this.getClient(context).sendTokenToMany(this.getWalletAddress(context), asset, payout);
  }

  async getPayoutCompletionData(context: PayoutOrderContext, payoutTxId: string): Promise<[boolean, number]> {
    const transaction = await this.getClient(context).getTx(payoutTxId);

    const isComplete = transaction && transaction.blockhash && transaction.confirmations > 0;
    const payoutFee = isComplete ? -transaction.fee : 0;

    return [isComplete, payoutFee];
  }

  async getUtxoForAddress(address: string): Promise<number> {
    return parseFloat(await this.whaleService.getClient().getBalance(address));
  }

  getWalletAddress(context: PayoutOrderContext): string {
    if (context === PayoutOrderContext.BUY_CRYPTO) return Config.blockchain.default.outWalletAddress;
    if (context === PayoutOrderContext.STAKING_REWARD) return Config.blockchain.default.intWalletAddress;
  }

  isLightWalletAddress(address: string): boolean {
    return ['df1', 'tf1'].includes(address.slice(0, 3));
  }

  private getClient(context: PayoutOrderContext): DeFiClient {
    if (context === PayoutOrderContext.BUY_CRYPTO) return this.#outClient;
    if (context === PayoutOrderContext.STAKING_REWARD) return this.#intClient;
  }
}
