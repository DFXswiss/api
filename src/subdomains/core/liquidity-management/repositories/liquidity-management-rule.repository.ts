import { EntityRepository, Repository } from 'typeorm';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';

@EntityRepository(LiquidityManagementRule)
export class LiquidityManagementRuleRepository extends Repository<LiquidityManagementRule> {}
