import { IsInt, IsOptional } from 'class-validator';

export class LiquidityManagementRuleSettingsDto {
  @IsOptional()
  @IsInt()
  reactivationTime?: number;
}
