import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';
import { Util } from 'src/shared/utils/util';
import { PaymentStandard } from '../enums';

export class CreateInvoicePaymentDto {
  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.routeId || !(b.route || b.r)))
  routeId: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.route || !(b.routeId || b.r)))
  route: string;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.r || !(b.routeId || b.route)))
  r: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.externalId || !(b.e || b.message || b.m)))
  @Transform(Util.sanitize)
  externalId: string;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.e || !(b.externalId || b.message || b.m)))
  @Transform(Util.sanitize)
  e: string;

  @ApiPropertyOptional()
  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.message || !(b.m || b.externalId || b.e)))
  message: string;

  @IsNotEmpty()
  @IsString()
  @Transform(Util.sanitize)
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.m || !(b.message || b.externalId || b.e)))
  m: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  label?: string;

  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  l?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  note?: string;

  @IsOptional()
  @IsString()
  @Transform(Util.sanitize)
  n?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.amount || !b.a))
  amount: string;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(!b.amount || b.a))
  a: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  c?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  d: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(PaymentStandard)
  standard?: PaymentStandard;

  @IsOptional()
  @IsEnum(PaymentStandard)
  s?: PaymentStandard;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @IsOptional()
  @IsUrl()
  w?: string;
}
