import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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
}
