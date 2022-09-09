import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../repositories/payout-order.repository';
import { PrepareEvmStrategy } from './base/prepare-evm.strategy';

@Injectable()
export class PrepareBscStrategy extends PrepareEvmStrategy {
  constructor(payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }
}
