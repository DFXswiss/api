import { ApiProperty } from '@nestjs/swagger';
import { PaymentLinkStatus } from './payment-link.dto';

export class UpdatePaymentLinkDto {
  @ApiProperty()
  status: PaymentLinkStatus;
}
