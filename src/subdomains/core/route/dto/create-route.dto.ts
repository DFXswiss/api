import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Buy } from '../../buy-crypto/routes/buy/buy.entity';
import { Swap } from '../../buy-crypto/routes/swap/swap.entity';
import { Sell } from '../../sell-crypto/route/sell.entity';

export class CreateRouteDto {
  @IsNotEmpty()
  @IsString()
  label: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  buy?: Buy;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  sell?: Sell;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  swap?: Swap;
}
