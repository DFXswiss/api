import { BadRequestException } from '@nestjs/common';
import { LiquidityManagementRule } from '../entities/liquidity-management-rule.entity';

export class LiquidityManagementRuleInitSpecification {
  public static isSatisfiedBy(rule: LiquidityManagementRule): boolean {
    if (rule.targetAsset && rule.targetFiat) {
      throw new BadRequestException('Cannot create rule. Provide targetAsset or targetFiat, not both.');
    }

    if (!rule.minimal && !rule.maximal) {
      throw new BadRequestException('Cannot create rule. Neither minimal or maximal constraint was provided');
    }

    if (rule.minimal && rule.minimal > rule.optimal) {
      throw new BadRequestException('Cannot create rule. Minimal liquidity configuration must be lower than optimal');
    }

    if (rule.maximal && rule.maximal < rule.optimal) {
      throw new BadRequestException('Cannot create rule. Maximal liquidity configuration must be higher than optimal');
    }

    if (rule.minimal && !rule.deficitStartAction) {
      throw new BadRequestException('Cannot create rule. Deficit actions must be provided for minimal liquidity');
    }

    if (rule.maximal && !rule.redundancyStartAction) {
      throw new BadRequestException('Cannot create rule. Redundancy actions must be provided for maximal liquidity');
    }

    return true;
  }
}
