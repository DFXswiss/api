import { IsNumber, IsOptional } from 'class-validator';

export class UpdateTradingRuleDto {
  @IsOptional()
  @IsNumber()
  lowerLimit: number;

  @IsOptional()
  @IsNumber()
  upperLimit: number;

  @IsOptional()
  @IsNumber()
  reactivationTime: number;
}
