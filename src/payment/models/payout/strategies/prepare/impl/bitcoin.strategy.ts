import { Injectable } from '@nestjs/common';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { AutoConfirmStrategy } from './base/auto-confirm.strategy';

@Injectable()
export class BitcoinStrategy extends AutoConfirmStrategy {
  constructor(payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }
}
