import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PaymentLinkStatus } from '../enums';
import { PaymentLinkRecipientDto } from './payment-link.dto';

export class UpdatePaymentLinkDto {
  @ApiPropertyOptional({ enum: PaymentLinkStatus })
  @IsOptional()
  @IsEnum(PaymentLinkStatus)
  status?: PaymentLinkStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional({ type: PaymentLinkRecipientDto })
  @IsOptional()
  @Type()
  @ValidateNested()
  recipient?: PaymentLinkRecipientDto;
}
