import { Injectable } from '@nestjs/common';
import { Config } from 'src/config/config';
import { DeFiClient } from 'src/integration/blockchain/ain/node/defi-client';
import { NodeService, NodeType } from 'src/integration/blockchain/ain/node/node.service';
import { WhaleService } from 'src/integration/blockchain/ain/whale/whale.service';
import { PayoutOrderContext } from '../entities/payout-order.entity';
import { PayoutBitcoinBasedService, PayoutGroup } from './base/payout-bitcoinbased.service';

@Injectable()
export class PayoutDeFiChainService extends PayoutBitcoinBasedService {
  #client: DeFiClient;

  constructor(readonly nodeService: NodeService, readonly whaleService: WhaleService) {
    super();
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.#client = client));
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
    return parseFloat(await this.whaleService.getCurrentClient().getBalance(address));
  }

  getWalletAddress(_context: PayoutOrderContext): string {
    return Config.blockchain.default.dex.address;
  }

  isLightWalletAddress(address: string): boolean {
    return ['df1', 'tf1'].includes(address.slice(0, 3));
  }

  private getClient(_context: PayoutOrderContext): DeFiClient {
    return this.#client;
  }
}
