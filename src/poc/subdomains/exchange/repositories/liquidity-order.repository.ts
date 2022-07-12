import { EntityRepository, Repository } from 'typeorm';
import { PocLiquidityOrder } from '../models/liquidity-order.entity';

@EntityRepository(PocLiquidityOrder)
export class PocLiquidityOrderRepository extends Repository<PocLiquidityOrder> {}
