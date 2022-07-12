import { Injectable } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';
import { NodeClient } from 'src/ain/node/node-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { BuyCrypto } from 'src/payment/models/buy-crypto/entities/buy-crypto.entity';
import { PayoutCompleteEvent } from '../events/payout-complete.event';
import { PayoutUtil } from '../utils/payout.util';
import { DoPayoutStrategy } from './common/do-payout.strategy';

@Injectable()
export class PayoutDFIStrategy extends DoPayoutStrategy {
  private outClient: NodeClient;

  constructor(private readonly eventBus: EventBus, readonly nodeService: NodeService) {
    super();
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
  }

  async doPayout(tx: BuyCrypto): Promise<void> {
    const payout = PayoutUtil.aggregatePayout([tx]);
    const txId = await this.outClient.sendUtxoToMany(payout);

    console.log('Paid out DFI', txId);

    this.eventBus.publish(new PayoutCompleteEvent(tx.id, txId));
  }
}
