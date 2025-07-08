import { BadRequestException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { LnurlpInvoiceDto } from 'src/integration/lightning/dto/lnurlp.dto';
import { PaymentActivation } from '../entities/payment-activation.entity';
import { PaymentLinkEvmPaymentDto } from './payment-link.dto';

export class PaymentRequestMapper {
  static toPaymentRequest(paymentActivation?: PaymentActivation): LnurlpInvoiceDto | PaymentLinkEvmPaymentDto {
    switch (paymentActivation?.method) {
      case Blockchain.LIGHTNING:
        return this.toLnurlpInvoice(paymentActivation);

      case Blockchain.ETHEREUM:
      case Blockchain.ARBITRUM:
      case Blockchain.OPTIMISM:
      case Blockchain.BASE:
      case Blockchain.GNOSIS:
      case Blockchain.POLYGON:
      case Blockchain.MONERO:
      case Blockchain.BITCOIN:
      case Blockchain.SOLANA:
        return this.toPaymentLinkPayment(paymentActivation.method, paymentActivation);

      case Blockchain.BINANCE_PAY:
        return this.toBinancePayPayment(paymentActivation.method, paymentActivation);

      default:
        throw new BadRequestException(`Invalid method ${paymentActivation?.method}`);
    }
  }

  private static toLnurlpInvoice(paymentActivation: PaymentActivation): LnurlpInvoiceDto {
    return { pr: paymentActivation.paymentRequest };
  }

  private static toPaymentLinkPayment(
    method: Blockchain,
    paymentActivation: PaymentActivation,
  ): PaymentLinkEvmPaymentDto {
    const infoUrl = `${Config.url()}/lnurlp/tx/${paymentActivation.payment.uniqueId}`;

    return {
      expiryDate: paymentActivation.expiryDate,
      blockchain: method,
      uri: paymentActivation.paymentRequest,
      hint: `Use this data to create a transaction and sign it. Send the signed transaction back as HEX via the endpoint ${infoUrl}. We check the transferred HEX and broadcast the transaction to the blockchain.`,
    };
  }

  private static toBinancePayPayment(method: Blockchain, paymentActivation: PaymentActivation): any {
    return {
      expiryDate: paymentActivation.expiryDate,
      uri: paymentActivation.paymentRequest,
      hint: `Pay in the Binance app by following the deep link ${paymentActivation.paymentRequest}.`,
    };
  }
}
