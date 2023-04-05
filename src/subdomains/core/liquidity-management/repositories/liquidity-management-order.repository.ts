import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';

@Injectable()
export class LiquidityManagementOrderRepository extends BaseRepository<LiquidityManagementOrder> {
  constructor(manager: EntityManager) {
    super(LiquidityManagementOrder, manager);
  }
}
