import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PriceSource } from '../domain/entities/price-rule.entity';

export class PriceRequestRaw {
  @IsNotEmpty()
  @IsEnum(PriceSource)
  source: PriceSource;

  @IsNotEmpty()
  @IsString()
  from: string;

  @IsNotEmpty()
  @IsString()
  to: string;

  @IsOptional()
  @IsString()
  param: string;
}
