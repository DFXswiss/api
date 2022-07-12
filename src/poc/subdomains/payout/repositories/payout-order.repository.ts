import { EntityRepository, Repository } from 'typeorm';
import { PocPayoutOrder } from '../models/payout-order.entity';

@EntityRepository(PocPayoutOrder)
export class PocPayoutOrderRepository extends Repository<PocPayoutOrder> {}
