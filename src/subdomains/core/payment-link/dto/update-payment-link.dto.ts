import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { EntityDto } from 'src/shared/dto/entity.dto';
import { Country } from 'src/shared/models/country/country.entity';
import { PaymentLinkStatus } from '../enums';
import { PaymentLinkRecipientDto } from './payment-link.dto';

export class UpdatePaymentLinkBaseDto {
  @ApiPropertyOptional({ enum: PaymentLinkStatus })
  @IsOptional()
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookUrl?: string;
}

export class UpdatePaymentLinkDto extends UpdatePaymentLinkBaseDto {
  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  recipient?: PaymentLinkRecipientDto;
}

export class UpdatePaymentLinkInternalDto {
  @IsOptional()
  @IsString()
  externalId: string;

  @IsOptional()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  street: string;

  @IsOptional()
  @IsString()
  houseNumber: string;

  @IsOptional()
  @IsString()
  zip: string;

  @IsOptional()
  @IsString()
  city: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EntityDto)
  country: Country;

  @IsOptional()
  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  mail: string;

  @IsOptional()
  @IsString()
  website: string;

  @IsOptional()
  @IsString()
  config: string;
}
