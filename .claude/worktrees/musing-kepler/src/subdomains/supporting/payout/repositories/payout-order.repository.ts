import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PayoutOrder } from '../entities/payout-order.entity';

@Injectable()
export class PayoutOrderRepository extends BaseRepository<PayoutOrder> {
  constructor(manager: EntityManager) {
    super(PayoutOrder, manager);
  }
}
