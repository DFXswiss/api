import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TradingOrder } from '../entities/trading-order.entity';

@Injectable()
export class TradingOrderRepository extends BaseRepository<TradingOrder> {
  constructor(manager: EntityManager) {
    super(TradingOrder, manager);
  }
}
