import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { AutoConfirmStrategy } from './auto-confirm.strategy';

export abstract class EvmStrategy extends AutoConfirmStrategy {
  constructor(payoutOrderRepo: PayoutOrderRepository) {
    super(payoutOrderRepo);
  }
}
