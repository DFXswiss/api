import { Injectable } from '@nestjs/common';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityManagementRuleCreationDto } from '../dto/input/liquidity-management-rule-creation.dto';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';

@Injectable()
export class LiquidityManagementRuleFactory {
  static create(
    dto: LiquidityManagementRuleCreationDto,
    targetAsset: Asset,
    targetFiat: Fiat,
    firstDeficitAction: LiquidityManagementAction,
    firstRedundancyAction: LiquidityManagementAction,
  ): LiquidityManagementRule {
    const { context, minimal, optimal, maximal, reactivationTime } = dto;

    return LiquidityManagementRule.create(
      context,
      targetAsset,
      targetFiat,
      minimal,
      optimal,
      maximal,
      firstDeficitAction,
      firstRedundancyAction,
      reactivationTime,
    );
  }
}
