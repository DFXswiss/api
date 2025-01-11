import { IsEnum, IsInt, IsNumber, IsOptional } from 'class-validator';
import { TradingRuleStatus } from '../enums';

export class UpdateTradingRuleDto {
  @IsOptional()
  @IsNumber()
  lowerLimit: number;

  @IsOptional()
  @IsNumber()
  upperLimit: number;

  @IsOptional()
  @IsNumber()
  lowerTarget: number;

  @IsOptional()
  @IsNumber()
  upperTarget: number;

  @IsOptional()
  @IsInt()
  reactivationTime: number;

  @IsOptional()
  @IsEnum(TradingRuleStatus)
  status: TradingRuleStatus;
}
