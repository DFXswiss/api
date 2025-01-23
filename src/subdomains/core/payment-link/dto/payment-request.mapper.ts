import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { PaymentActivation } from '../entities/payment-activation.entity';
import { PaymentLinkEvmPaymentDto } from './payment-link.dto';

export class PaymentRequestMapper {
  static toPaymentRequest(paymentActivation?: PaymentActivation): LnurlpInvoiceDto | PaymentLinkEvmPaymentDto {
    return paymentActivation.method === Blockchain.LIGHTNING
      ? this.toLnurlpInvoice(paymentActivation)
      : this.toPaymentLinkEvmPayment(paymentActivation);
  }

  private static toLnurlpInvoice(paymentActivation: PaymentActivation): LnurlpInvoiceDto {
    return { pr: paymentActivation.paymentRequest };
  }

  private static toPaymentLinkEvmPayment(paymentActivation: PaymentActivation): PaymentLinkEvmPaymentDto {
    const infoUrl = `${Config.url()}/lnurlp/tx/${paymentActivation.payment.uniqueId}`;

    return {
      expiryDate: paymentActivation.expiryDate,
      blockchain: paymentActivation.method,
      uri: paymentActivation.paymentRequest,
      hint: `Use this data to create a transaction and sign it. Send the signed transaction back as HEX via the endpoint ${infoUrl}. We check the transferred HEX and broadcast the transaction to the blockchain.`,
    };
  }
}
