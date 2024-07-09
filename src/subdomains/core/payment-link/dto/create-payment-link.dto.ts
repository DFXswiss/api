import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreatePaymentLinkPaymentDto } from './create-payment-link-payment.dto';

export class CreatePaymentLinkDto {
  @ApiProperty()
  @IsNumber()
  @IsNotEmpty()
  route: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId: string;

  @ApiPropertyOptional({ type: CreatePaymentLinkPaymentDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  payment: CreatePaymentLinkPaymentDto;
}
