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
      case Blockchain.POLYGON:
      case Blockchain.MONERO:
      case Blockchain.BITCOIN:
        return this.toPaymentLinkEvmPayment(paymentActivation.method, paymentActivation);

      case Blockchain.BINANCE_PAY:
        return this.toBinancePayPayment(paymentActivation.method, paymentActivation);

      default:
        throw new BadRequestException(`Invalid method ${paymentActivation?.method}`);
    }
  }

  private static toLnurlpInvoice(paymentActivation: PaymentActivation): LnurlpInvoiceDto {
    return { pr: paymentActivation.paymentRequest };
  }

  private static toPaymentLinkEvmPayment(
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
      blockchain: method,
      uri: paymentActivation.paymentRequest,
      hint: `Pay in the Binance app by following the deep link ${paymentActivation.paymentRequest}.`,
    };

    /*
    // Define this as this go directly to the client trying to pay for a purchase and potentially to binance pay server
    // Ideally we return the same response that we get from the binance pay server, but defining this as EVM for the demo
    return {
      currency: 'USDT',
      totalFee: '25.17',
      prepayId: '363969700195475456',
      terminalType: 'APP',
      expireTime: 1747326999067,
      qrcodeLink: 'https://public.bnbstatic.com/static/payment/20250515/10d4263e-29b5-4cd5-a094-5a44b58fc94f.jpg',
      qrContent: 'https://app.binance.com/qr/dplk8d729cd0b5b646fa96dc4f951bcb488b',
    checkoutUrl: 'https://pay.binance.com/en/checkout/637e918899f14f128010b28372a167a1',
    deeplink: 'bnc://app.binance.com/payment/secpay?tempToken=Y227jEaCxWU0KFsWPd0URnKE7wg4dB4M',
    universalUrl: 'https://app.binance.com/payment/secpay?li
    };
    */
  }
}
