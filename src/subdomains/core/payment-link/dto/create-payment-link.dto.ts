import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreatePaymentLinkPaymentDto } from './create-payment-link-payment.dto';

export class CreatePaymentLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  routeId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ type: CreatePaymentLinkPaymentDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  payment?: CreatePaymentLinkPaymentDto;
}
