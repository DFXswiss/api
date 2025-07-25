import { TransferInfo } from 'src/subdomains/core/payment-link/dto/payment-link.dto';
import { PaymentLinkPayment } from 'src/subdomains/core/payment-link/entities/payment-link-payment.entity';
import { PaymentLink } from 'src/subdomains/core/payment-link/entities/payment-link.entity';
import { PaymentQuote } from 'src/subdomains/core/payment-link/entities/payment-quote.entity';
import { C2BPaymentStatus } from '../enums';

export interface C2BOrderResult {
  providerOrderId: string;
  paymentRequest: string;
  metadata?: Record<string, any>;
}

export interface C2BWebhookResult {
  providerOrderId: string;
  status: C2BPaymentStatus;
  metadata?: Record<string, any>;
}

export interface C2BPaymentLinkProvider<WebhookDto> {
  createOrder(payment: PaymentLinkPayment, transferInfo: TransferInfo, quote: PaymentQuote): Promise<C2BOrderResult>;
  verifySignature(payload: WebhookDto, headers: any): Promise<boolean>;
  handleWebhook(payload: WebhookDto): Promise<C2BWebhookResult | undefined>;
  isPaymentLinkEnrolled(paymentLink: PaymentLink): boolean;
  enrollPaymentLink(paymentLink: PaymentLink): Promise<Record<string, string>>;
}
