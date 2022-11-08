import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { LiquidityManagementContext } from '../enums';
import { LiquidityManagementActionDto } from './liquidity-management-action.dto';

export class LiquidityManagementRuleCreationDto {
  @IsNotEmpty()
  @IsEnum(LiquidityManagementContext)
  context: LiquidityManagementContext;

  @IsNotEmpty()
  // TODO - add XOR validator
  @ValidateIf((dto) => !dto.targetFiatId)
  @IsInt()
  targetAssetId: number;

  @IsNotEmpty()
  // TODO - add XOR validator
  @ValidateIf((dto) => !dto.targetAssetId)
  @IsInt()
  targetFiatId: number;

  @IsNotEmpty()
  @IsNumber()
  minimal: number;

  @IsNotEmpty()
  @IsNumber()
  optimal: number;

  @IsNotEmpty()
  @IsNumber()
  maximum: number;

  @IsOptional()
  @IsNumber()
  minimalDeviation?: number;

  @IsNotEmpty()
  @IsArray()
  // TODO - add XOR validator - at least one array should be not empty
  @ValidateNested({ each: true })
  @Type(() => LiquidityManagementActionDto)
  deficitActions: LiquidityManagementActionDto[];

  @IsNotEmpty()
  @IsArray()
  // TODO - add XOR validator - at least one array should be not empty
  @ValidateNested({ each: true })
  @Type(() => LiquidityManagementActionDto)
  redundancyActions: LiquidityManagementActionDto[];
}
