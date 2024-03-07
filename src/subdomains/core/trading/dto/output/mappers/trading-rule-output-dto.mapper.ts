import { TradingRule } from '../../../entities/trading-rule.entity';
import { TradingRuleOutputDto } from '../trading-rule-output.dto';

export class TradingRuleOutputDtoMapper {
  static entityToDto(rule: TradingRule): TradingRuleOutputDto {
    const dto = new TradingRuleOutputDto();

    dto.status = rule.status;
    dto.leftAssetId = rule.leftAsset.id;
    dto.rightAssetId = rule.rightAsset.id;
    dto.source1 = rule.source1;
    dto.leftAsset1 = rule.leftAsset1;
    dto.rightAsset1 = rule.rightAsset1;
    dto.source2 = rule.source2;
    dto.leftAsset2 = rule.leftAsset2;
    dto.rightAsset2 = rule.rightAsset2;
    dto.lowerLimit = rule.lowerLimit;
    dto.upperLimit = rule.upperLimit;
    dto.reactivationTime = rule.reactivationTime;

    return dto;
  }
}
