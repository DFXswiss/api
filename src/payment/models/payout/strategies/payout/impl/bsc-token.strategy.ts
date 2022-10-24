import { Injectable } from '@nestjs/common';
import { PayoutOrder } from '../../../entities/payout-order.entity';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutBscService } from '../../../services/payout-bsc.service';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscTokenStrategy extends EvmStrategy {
  constructor(protected readonly bscService: PayoutBscService, payoutOrderRepo: PayoutOrderRepository) {
    super(bscService, payoutOrderRepo);
  }

  estimateFee(quantityOfTransactions: number): Promise<FeeResult> {}

  protected dispatchPayout(order: PayoutOrder): Promise<string> {
    return this.bscService.sendToken(order.destinationAddress, order.asset, order.amount);
  }
}
