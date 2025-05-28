import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class LiquidityManagementRequestDto {
  @IsNotEmpty()
  @IsInt()
  assetId: number;

  @IsNotEmpty()
  @IsNumber()
  minAmount: number;

  @IsOptional()
  @IsNumber()
  maxAmount?: number;

  @IsNotEmpty()
  @IsBoolean()
  targetOptimal: boolean;
}
