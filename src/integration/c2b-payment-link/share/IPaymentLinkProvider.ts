import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { C2BPaymentStatus } from './PaymentStatus';

export interface OrderResult {
  providerOrderId: string;
  paymentRequest: string;
  metadata?: Record<string, any>;
}

export interface WebhookResult {
  providerOrderId: string;
  status: C2BPaymentStatus;
  metadata?: Record<string, any>;
}

export interface IPaymentLinkProvider<WebhookDto> {
  createOrder(payment: PaymentLinkPayment, transferInfo: TransferInfo, quote: PaymentQuote): Promise<OrderResult>;
  verifySignature(payload: WebhookDto, headers: any): Promise<boolean>;
  handleWebhook(payload: WebhookDto): Promise<WebhookResult>;
}
