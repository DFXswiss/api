import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { EvmStrategy } from './base/evm.strategy';

@Injectable()
export class BscStrategy extends EvmStrategy {
  constructor(payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }
}
