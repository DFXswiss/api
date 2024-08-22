import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class CreateInvoicePaymentDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.routeId || !b.r))
  routeId: string;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(!b.routeId || b.r))
  r: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(b.externalId || !b.e))
  externalId: string;

  @IsNotEmpty()
  @IsString()
  @ValidateIf((b: CreateInvoicePaymentDto) => Boolean(!b.externalId || b.e))
  e: string;

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
}
