import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { GoodsCategory, GoodsType, MerchantMCC, StoreType } from 'src/integration/c2b-payment-link/dto/binance.dto';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { PaymentLinkStatus } from '../enums';
import { UpdatePaymentLinkConfigDto } from './payment-link-config.dto';
import { Util } from 'src/shared/utils/util';

export class UpdatePaymentLinkDto {
  @ApiPropertyOptional({ enum: PaymentLinkStatus })
  @IsOptional()
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  webhookUrl?: string;

  @ApiPropertyOptional({ type: UpdatePaymentLinkConfigDto })
  @IsOptional()
  @Type(() => UpdatePaymentLinkConfigDto)
  @ValidateNested()
  config?: UpdatePaymentLinkConfigDto;
}

export class UpdatePaymentLinkInternalDto {
  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  street?: string;

  @IsOptional()
  @IsString()
  houseNumber?: string;

  @IsOptional()
  @IsString()
  zip?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  country?: Country;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  mail?: string;

  @IsOptional()
  @IsString()
  regionManager?: string;

  @IsOptional()
  @IsString()
  storeManager?: string;

  @IsOptional()
  @IsString()
  storeOwner?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  config?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsEnum(StoreType)
  storeType?: StoreType;

  @IsOptional()
  @IsEnum(MerchantMCC)
  merchantMcc?: MerchantMCC;

  @IsOptional()
  @IsEnum(GoodsType)
  goodsType?: GoodsType;

  @IsOptional()
  @IsEnum(GoodsCategory)
  goodsCategory?: GoodsCategory;
}
