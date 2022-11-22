import { EntityRepository, Repository } from 'typeorm';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';

@EntityRepository(LiquidityManagementAction)
export class LiquidityManagementActionRepository extends Repository<LiquidityManagementAction> {}
