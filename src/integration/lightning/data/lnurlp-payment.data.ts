import { PaymentDto } from '../dto/payment.dto';

export interface LnurlpPaymentData {
  paymentDto: PaymentDto;
  lnurl: string;
}
