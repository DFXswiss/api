import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreatePaymentLinkPaymentDto } from './create-payment-link-payment.dto';
import { PaymentLinkRecipientDto } from './payment-link.dto';

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
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  recipient?: PaymentLinkRecipientDto;

  @ApiPropertyOptional({ type: CreatePaymentLinkPaymentDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  payment?: CreatePaymentLinkPaymentDto;
}
