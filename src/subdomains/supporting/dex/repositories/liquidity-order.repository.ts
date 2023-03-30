import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityOrder } from '../entities/liquidity-order.entity';

@Injectable()
export class LiquidityOrderRepository extends BaseRepository<LiquidityOrder> {
  constructor(manager: EntityManager) {
    super(LiquidityOrder, manager);
  }
}
