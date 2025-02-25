import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { CustodyActionOrder } from '../entities/custofy-action-order.entity';

@Injectable()
export class CustodyActionOrderRepository extends BaseRepository<CustodyActionOrder> {
  constructor(manager: EntityManager) {
    super(CustodyActionOrder, manager);
  }
}
