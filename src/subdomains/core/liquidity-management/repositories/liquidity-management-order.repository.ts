import { EntityRepository, Repository } from 'typeorm';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';

@EntityRepository(LiquidityManagementOrder)
export class LiquidityManagementOrderRepository extends Repository<LiquidityManagementOrder> {}
