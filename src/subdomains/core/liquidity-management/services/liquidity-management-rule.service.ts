import { Injectable } from '@nestjs/common';
import { LiquidityManagementRuleRepository } from '../repositories/liquidity-management-rule.repository';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';
import { LiquidityManagementRuleCreationDto } from '../dto/liquidity-management-rule-creation.dto';

@Injectable()
export class LiquidityManagementRuleService {
  constructor(private readonly ruleRepo: LiquidityManagementRuleRepository) {}

  //*** PUBLIC API ***//

  async createRule(dto: LiquidityManagementRuleCreationDto): Promise<LiquidityManagementRule> {
    const rule = LiquidityManagementRule.create();

    this.ruleRepo;
  }

  //*** HELPER METHODS ***//
}
