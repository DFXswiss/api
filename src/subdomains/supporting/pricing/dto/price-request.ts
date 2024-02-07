import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PriceSource } from '../domain/entities/price-rule.entity';

export class PriceRequest {
  @IsNotEmpty()
  @IsEnum(PriceSource)
  source: PriceSource;

  @IsNotEmpty()
  @IsString()
  from: string;

  @IsNotEmpty()
  @IsString()
  to: string;
}
