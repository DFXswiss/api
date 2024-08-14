import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityManagementRuleStatus, LiquidityManagementType } from '../../enums';

export class LiquidityManagementRuleOutputDto {
  context: LiquidityManagementType;
  status: LiquidityManagementRuleStatus;
  targetAsset: Asset;
  targetFiat: Fiat;
  minimal: number;
  optimal: number;
  maximal: number;
  deficitStartActionId: number;
  redundancyStartActionId: number;
}
