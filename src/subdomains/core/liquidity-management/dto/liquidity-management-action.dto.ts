import { IsEnum, IsInt, IsNotEmpty, IsOptional } from 'class-validator';
import { LiquidityManagementSystem } from '../enums';

export class LiquidityManagementActionDto {
  @IsNotEmpty()
  @IsInt()
  stepNumber: number;

  @IsNotEmpty()
  @IsEnum(LiquidityManagementSystem)
  system: LiquidityManagementSystem;

  @IsOptional()
  @IsInt()
  stepNumberOnSuccess: number;

  @IsOptional()
  @IsInt()
  stepNumberOnFail: number;
}
