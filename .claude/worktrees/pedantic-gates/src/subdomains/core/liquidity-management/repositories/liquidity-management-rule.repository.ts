import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';

@Injectable()
export class LiquidityManagementRuleRepository extends BaseRepository<LiquidityManagementRule> {
  constructor(manager: EntityManager) {
    super(LiquidityManagementRule, manager);
  }
}
