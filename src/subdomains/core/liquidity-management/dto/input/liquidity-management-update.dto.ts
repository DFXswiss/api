import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class LiquidityManagementRuleUpdateDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  optimal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limit: number;

  @IsOptional()
  @IsInt()
  reactivationTime?: number;
}
