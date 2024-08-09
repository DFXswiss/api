import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { PaymentLinkStatus } from '../enums';

export class UpdatePaymentLinkDto {
  @ApiProperty({ enum: PaymentLinkStatus })
  @IsNotEmpty()
  @IsEnum(PaymentLinkStatus)
  status: PaymentLinkStatus;
}
