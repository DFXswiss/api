import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BuyFiat } from '../../../../core/sell-crypto/buy-fiat/buy-fiat.entity';

export class CreateFiatOutputDto {
  @IsOptional()
  @Type(() => BuyFiat)
  buyFiat: BuyFiat;

  @IsNotEmpty()
  @IsString()
  reason: string;
}
