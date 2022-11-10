import { LiquidityManagementRule } from '../../../entities/liquidity-management-rule.entity';
import { LiquidityManagementRuleOutputDto } from '../liquidity-management-rule-output.dto';

export class LiquidityManagementRuleOutputDtoMapper {
  static entityToDto(entity: LiquidityManagementRule): LiquidityManagementRuleOutputDto {
    const dto = new LiquidityManagementRuleOutputDto();

    dto.context = entity.context;
    dto.status = entity.status;
    dto.targetAsset = entity.targetAsset;
    dto.targetFiat = entity.targetFiat;
    dto.minimum = entity.minimum;
    dto.optimal = entity.optimal;
    dto.maximum = entity.maximum;
    dto.deficitStartActionId = entity.deficitStartAction?.id;
    dto.redundancyStartActionId = entity.redundancyStartAction?.id;

    return dto;
  }
}
