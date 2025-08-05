import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkMode, PaymentLinkStatus } from '../enums';
import { UpdatePaymentLinkConfigDto } from './payment-link-config.dto';

export class UpdatePaymentLinkDto {
  @ApiPropertyOptional({ enum: PaymentLinkStatus })
  @IsOptional()
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @ApiPropertyOptional({ enum: PaymentLinkMode })
  @IsOptional()
  @IsEnum(PaymentLinkMode)
  mode?: PaymentLinkMode;

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
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @IsOptional()
  @IsEnum(PaymentLinkMode)
  mode?: PaymentLinkMode;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  label?: string;

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
  config?: string;

  @IsOptional()
  @IsString()
  publicStatus?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
