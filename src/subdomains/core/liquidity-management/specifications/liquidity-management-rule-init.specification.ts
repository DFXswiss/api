import { BadRequestException } from '@nestjs/common';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';

export class LiquidityManagementRuleInitSpecification {
  public static isSatisfiedBy(rule: LiquidityManagementRule): boolean {
    if (rule.targetAsset && rule.targetFiat) {
      throw new BadRequestException('Cannot created rule. Provide targetAsset or targetFiat, not both.');
    }

    if (!rule.minimum && !rule.maximum) {
      throw new BadRequestException('Cannot created rule. Neither minimum or maximum constraint was provided');
    }

    if (rule.minimum && rule.minimum >= rule.optimal) {
      throw new BadRequestException('Cannot created rule. Minimum liquidity configuration must be lower than optimal');
    }

    if (rule.maximum && rule.maximum <= rule.optimal) {
      throw new BadRequestException('Cannot created rule. Maximum liquidity configuration must be higher than optimal');
    }

    if (rule.minimum && !rule.deficitStartAction) {
      throw new BadRequestException('Cannot created rule. Deficit actions must be provided for minimum liquidity');
    }

    if (rule.maximum && !rule.redundancyStartAction) {
      throw new BadRequestException('Cannot created rule. Redundancy actions must be provided for maximum liquidity');
    }

    return true;
  }
}
