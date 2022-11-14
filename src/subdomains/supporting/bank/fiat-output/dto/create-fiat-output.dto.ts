import { Type } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { BuyFiat } from '../../../../core/sell-crypto/buy-fiat/buy-fiat.entity';

export class CreateFiatOutputDto {
  @IsOptional()
  @Type(() => BuyFiat)
  buyFiat: BuyFiat;

  @IsOptional()
  @IsString()
  reason: string;
}
