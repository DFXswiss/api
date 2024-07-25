import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { PaymentActivation } from '../entities/payment-activation.entity';
import { PaymentLinkEvmPaymentDto } from './payment-link.dto';

export class PaymentRequestMapper {
  static toPaymentRequest(
    paymentActivation?: PaymentActivation,
  ): LnurlpInvoiceDto | PaymentLinkEvmPaymentDto | undefined {
    if (!paymentActivation) return;

    return paymentActivation.method === Blockchain.LIGHTNING
      ? this.toLnurlpInvoice(paymentActivation)
      : this.toPaymentLinkEvmPayment(paymentActivation);
  }

  private static toLnurlpInvoice(paymentActivation: PaymentActivation): LnurlpInvoiceDto {
    return { pr: paymentActivation.paymentRequest };
  }

  private static toPaymentLinkEvmPayment(paymentActivation: PaymentActivation): PaymentLinkEvmPaymentDto {
    return {
      expiryDate: paymentActivation.expiryDate,
      blockchain: paymentActivation.method,
      uri: paymentActivation.paymentRequest,
    };
  }
}
