import { EntityRepository, Repository } from 'typeorm';
import { LiquidityOrder } from '../entities/liquidity-order.entity';

@EntityRepository(LiquidityOrder)
export class LiquidityOrderRepository extends Repository<LiquidityOrder> {}
