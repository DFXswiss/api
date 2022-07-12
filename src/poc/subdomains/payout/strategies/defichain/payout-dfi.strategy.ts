import { Injectable } from '@nestjs/common';
import { DeFiClient } from 'src/ain/node/defi-client';
import { NodeService, NodeType } from 'src/ain/node/node.service';
import { PocPayoutOrder } from '../../models/payout-order.entity';
import { PocPayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PayoutUtil } from '../../utils/payout.util';
import { DoPayoutStrategy } from './do-payout.strategy';

@Injectable()
export class PayoutDFIStrategy extends DoPayoutStrategy {
  private outClient: DeFiClient;

  constructor(readonly nodeService: NodeService, private readonly payoutOrderRepo: PocPayoutOrderRepository) {
    super();
    nodeService.getConnectedNode(NodeType.OUTPUT).subscribe((client) => (this.outClient = client));
  }

  async doPayout(order: PocPayoutOrder): Promise<void> {
    const payout = PayoutUtil.aggregatePayout([order]);
    const payoutId = await this.outClient.sendUtxoToMany(payout);

    await this.payoutOrderRepo.save({ ...order, payoutId });
  }
}
