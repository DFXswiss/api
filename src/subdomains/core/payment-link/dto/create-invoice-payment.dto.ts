import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
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
  externalId: string;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.e || !(b.externalId || b.message || b.m)))
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
  @IsString()
  webhookUrl?: string;

  @IsOptional()
  @IsString()
  w?: string;
}
