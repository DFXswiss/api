import { IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { LiquidityManagementSystem } from '../../enums';

export class LiquidityManagementActionDto {
  @IsNotEmpty()
  @IsInt()
  stepNumber: number;

  @IsNotEmpty()
  @IsEnum(LiquidityManagementSystem)
  system: LiquidityManagementSystem;

  @IsNotEmpty()
  @IsString()
  command: string;

  @IsOptional()
  @IsInt()
  stepNumberOnSuccess: number;

  @IsOptional()
  @IsInt()
  stepNumberOnFail: number;

  @IsOptional()
  @IsObject()
  params: Record<string, unknown>;
}
