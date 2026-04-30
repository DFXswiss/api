import { LiquidityManagementRule } from '../../../entities/liquidity-management-rule.entity';
import { LiquidityManagementRuleOutputDto } from '../liquidity-management-rule-output.dto';

export class LiquidityManagementRuleOutputDtoMapper {
  static entityToDto(entity: LiquidityManagementRule): LiquidityManagementRuleOutputDto {
    const dto = new LiquidityManagementRuleOutputDto();

    dto.context = entity.context;
    dto.status = entity.status;
    dto.targetAsset = entity.targetAsset;
    dto.targetFiat = entity.targetFiat;
    dto.minimal = entity.minimal;
    dto.optimal = entity.optimal;
    dto.maximal = entity.maximal;
    dto.deficitStartActionId = entity.deficitStartAction?.id;
    dto.redundancyStartActionId = entity.redundancyStartAction?.id;

    return dto;
  }
}
