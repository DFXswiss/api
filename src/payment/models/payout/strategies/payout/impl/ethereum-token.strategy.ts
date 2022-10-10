import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutEthereumService } from '../../../services/payout-ethereum.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class EthereumTokenStrategy extends EvmStrategy {
  constructor(protected readonly ethereumService: PayoutEthereumService, payoutOrderRepo: PayoutOrderRepository) {
    super(ethereumService, payoutOrderRepo);
  }

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.ethereumService.sendToken(order.destinationAddress, order.asset, order.amount);
  }
}
