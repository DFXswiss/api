import { PaymentDto } from '../dto/payment.dto';

export interface LnUrlPPaymentData {
  paymentDto: PaymentDto;
  lnurl: string;
}
