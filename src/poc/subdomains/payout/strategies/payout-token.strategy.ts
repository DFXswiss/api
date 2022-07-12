import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { WhaleService } from 'src/ain/whale/whale.service';
import { Config } from 'src/config/config';
import { BuyCrypto } from 'src/payment/models/buy-crypto/entities/buy-crypto.entity';
import { PayoutCompleteEvent } from '../events/payout-complete.event';
import { PayoutUtil } from '../utils/payout.util';
import { DoPayoutStrategy } from './common/do-payout.strategy';

@Injectable()
export class PayoutTokenStrategy extends DoPayoutStrategy {
  private outClient: NodeClient;
  private dexClient: NodeClient;

  constructor(
    private readonly eventBus: EventBus,
    readonly nodeService: NodeService,
    private readonly whaleService: WhaleService,
  ) {
    super();
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
    nodeService.getConnectedNode(NodeType.DEX).subscribe((client) => (this.dexClient = client));
  }

  async doPayout(tx: BuyCrypto): Promise<void> {
    await this.checkUtxo(tx.targetAddress);

    const payout = PayoutUtil.aggregatePayout([tx]);

    const txId = await this.outClient.sendTokenToMany(Config.node.outWalletAddress, tx.outputAsset, payout);
    console.log('Paid out Token', txId);

    this.eventBus.publish(new PayoutCompleteEvent(tx.id, txId));
  }

  private async checkUtxo(address: string): Promise<void> {
    const utxo = await this.whaleService.getClient().getBalance(address);

    if (!parseFloat(utxo)) {
      await this.dexClient.sendToken(Config.node.dexWalletAddress, address, 'DFI', Config.node.minDfiDeposit / 2);
    }
  }
}
