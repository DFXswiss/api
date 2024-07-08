import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { CreatePaymentLinkPaymentDto } from './create-payment-link-payment.dto';

export class CreatePaymentLinkDto {
  @ApiProperty()
  @IsNumber()
  route: number;

  @ApiProperty()
  @IsString()
  externalId: string;

  @ApiProperty()
  @IsOptional()
  payment: CreatePaymentLinkPaymentDto;
}
