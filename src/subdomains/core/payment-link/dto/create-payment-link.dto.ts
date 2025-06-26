import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { PaymentLinkMode } from '../enums';
import { CreatePaymentLinkPaymentDto } from './create-payment-link-payment.dto';
import { UpdatePaymentLinkConfigDto } from './payment-link-config.dto';

export class CreatePaymentLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  routeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  route?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  label?: string;

  @ApiPropertyOptional({
    enum: PaymentLinkMode,
    description:
      'Possible values: Multiple(Default - can have multiple payments), Single(Only one payment can be created), Donation(Allows multiple payments, payments can be created anonymously)',
  })
  @IsOptional()
  @IsEnum(PaymentLinkMode)
  mode?: PaymentLinkMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiPropertyOptional({ type: CreatePaymentLinkPaymentDto })
  @IsOptional()
  @Type(() => CreatePaymentLinkPaymentDto)
  @ValidateNested()
  payment?: CreatePaymentLinkPaymentDto;

  @ApiPropertyOptional({ type: UpdatePaymentLinkConfigDto })
  @IsOptional()
  @Type(() => UpdatePaymentLinkConfigDto)
  @ValidateNested()
  config?: UpdatePaymentLinkConfigDto;
}
