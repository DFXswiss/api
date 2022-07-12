import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { PocPayoutOrder } from '../../models/payout-order.entity';
import { PocPayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutUtil } from '../../utils/payout.util';
import { DoPayoutStrategy } from './do-payout.strategy';

@Injectable()
export class PayoutTokenStrategy extends DoPayoutStrategy {
  private outClient: DeFiClient;
  private dexClient: DeFiClient;

  constructor(
    readonly nodeService: NodeService,
    private readonly whaleService: WhaleService,
    private readonly payoutOrderRepo: PocPayoutOrderRepository,
  ) {
    super();
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async doPayout(order: PocPayoutOrder): Promise<void> {
    await this.checkUtxo(order.destination);

    const payout = PayoutUtil.aggregatePayout([order]);

    const payoutId = await this.outClient.sendTokenToMany(Config.node.outWalletAddress, order.asset, payout);
    await this.payoutOrderRepo.save({ ...order, payoutId });
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.whaleService.getClient().getBalance(address);

    if (!parseFloat(utxo)) {
      await this.dexClient.sendToken(Config.node.dexWalletAddress, address, 'DFI', Config.node.minDfiDeposit / 2);
    }
  }
}
