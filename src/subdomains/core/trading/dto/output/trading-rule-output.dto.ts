import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { TradingRuleStatus } from '../../enums';

export class TradingRuleOutputDto {
  status: TradingRuleStatus;
  leftAssetId: number;
  rightAssetId: number;
  source1: PriceSource;
  leftAsset1: string;
  rightAsset1: string;
  source2: PriceSource;
  leftAsset2: string;
  rightAsset2: string;
  lowerLimit: number;
  upperLimit: number;
  reactivationTime: number;
}
