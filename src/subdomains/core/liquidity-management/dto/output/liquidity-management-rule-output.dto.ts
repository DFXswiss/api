import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityManagementContext, LiquidityManagementRuleStatus } from '../../enums';

export class LiquidityManagementRuleOutputDto {
  context: LiquidityManagementContext;
  status: LiquidityManagementRuleStatus;
  targetAsset: Asset;
  targetFiat: Fiat;
  minimum: number;
  optimal: number;
  maximum: number;
  deficitStartActionId: number;
  redundancyStartActionId: number;
}
