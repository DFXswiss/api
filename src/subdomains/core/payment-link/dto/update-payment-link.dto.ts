import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaymentLinkStatus } from '../enums';

export class UpdatePaymentLinkDto {
  @ApiPropertyOptional({ enum: PaymentLinkStatus })
  @IsOptional()
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookUrl?: string;
}
