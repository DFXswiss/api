import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaymentLinkPaymentMode } from '../enums';

export class CreatePaymentLinkPaymentDto {
  @ApiPropertyOptional({ enum: PaymentLinkPaymentMode })
  @IsOptional()
  @IsEnum(PaymentLinkPaymentMode)
  mode?: PaymentLinkPaymentMode;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiryDate?: Date;
}
