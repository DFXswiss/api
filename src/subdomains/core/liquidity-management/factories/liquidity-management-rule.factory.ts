import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityManagementRuleCreationDto } from '../dto/input/liquidity-management-rule-creation.dto';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';

@Injectable()
export class LiquidityManagementRuleFactory {
  static async create(
    dto: LiquidityManagementRuleCreationDto,
    targetAsset: Asset,
    targetFiat: Fiat,
    firstDeficitAction: LiquidityManagementAction,
    firstRedundancyAction: LiquidityManagementAction,
  ): Promise<LiquidityManagementRule> {
    const { context, minimum: minimal, optimal, maximum } = dto;

    return LiquidityManagementRule.create(
      context,
      targetAsset,
      targetFiat,
      minimal,
      optimal,
      maximum,
      firstDeficitAction,
      firstRedundancyAction,
    );
  }
}
