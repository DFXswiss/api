import { EntityRepository, Repository } from 'typeorm';
import { PayoutOrder } from '../entities/payout-order.entity';

@EntityRepository(PayoutOrder)
export class PayoutOrderRepository extends Repository<PayoutOrder> {}
