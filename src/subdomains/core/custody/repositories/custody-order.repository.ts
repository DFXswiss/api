import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyOrder } from '../entities/custody-order.entity';

@Injectable()
export class CustodyOrderRepository extends BaseRepository<CustodyOrder> {
  constructor(manager: EntityManager) {
    super(CustodyOrder, manager);
  }
}
