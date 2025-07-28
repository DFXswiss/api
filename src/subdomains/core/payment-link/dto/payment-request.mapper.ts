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

      case Blockchain.KUCOIN_PAY:
      case Blockchain.BINANCE_PAY:
        return this.toC2BPayment(paymentActivation.method, paymentActivation);

      case 'Ark':
        return this.toArkPayment(paymentActivation);

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

    const hint = [Blockchain.MONERO, Blockchain.SOLANA].includes(method)
      ? `Use this data to create a transaction and sign it. Broadcast the signed transaction to the blockchain and send the transaction hash back via the endpoint ${infoUrl}`
      : `Use this data to create a transaction and sign it. Send the signed transaction back as HEX via the endpoint ${infoUrl}. We check the transferred HEX and broadcast the transaction to the blockchain.`;

    return {
      expiryDate: paymentActivation.expiryDate,
      blockchain: method,
      uri: paymentActivation.paymentRequest,
      hint,
    };
  }

  private static toC2BPayment(method: Blockchain, paymentActivation: PaymentActivation): any {
    const appName = method === Blockchain.KUCOIN_PAY ? 'Kucoin' : 'Binance';

    return {
      expiryDate: paymentActivation.expiryDate,
      uri: paymentActivation.paymentRequest,
      hint: `Pay in the ${appName} app by following the deep link ${paymentActivation.paymentRequest}.`,
    };
  }

  private static toArkPayment(paymentActivation: PaymentActivation): any {
    return {
      expiryDate: paymentActivation.expiryDate,
      address: 'ark1qp9wsjfpsj5v5ex022v6tmhukkw3erjpv68xvl0af5zzukrk6dr529ecxra5lpyt4jfhqtnj4kmr3mtgg9urn55ffypduxwn5k454vpcgw3z44',
      hint: 'Send the specified amount of sat in the specified time to the ark address given above.',
    };
  }
}
