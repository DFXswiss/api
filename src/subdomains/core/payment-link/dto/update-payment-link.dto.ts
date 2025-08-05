import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkStatus } from '../enums';
import { UpdatePaymentLinkConfigDto } from './payment-link-config.dto';

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
  @IsUrl()
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
  publicStatus?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
