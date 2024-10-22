import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkDto, PaymentLinkPaymentDto } from './payment-link.dto';

export class PaymentLinkDtoMapper {
  static toLinkDto(paymentLink: PaymentLink): PaymentLinkDto {
    const dto = PaymentLinkDtoMapper.createPaymentLinkDto(paymentLink);
    dto.payment = PaymentLinkDtoMapper.createPaymentLinkPaymentDto(paymentLink.payments?.[0]);

    return Object.assign(new PaymentLinkDto(), dto);
  }

  static toLinkDtoList(paymentLinks: PaymentLink[]): PaymentLinkDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.toLinkDto);
  }

  static toLinkWithPaymentListDto(paymentLink: PaymentLink): PaymentLinkDto {
    const dto = PaymentLinkDtoMapper.createPaymentLinkDto(paymentLink);
    dto.payment = PaymentLinkDtoMapper.toPaymentDtoList(paymentLink.payments);

    return Object.assign(new PaymentLinkDto(), dto);
  }

  static toLinkWithPaymentListDtoList(paymentLinks: PaymentLink[]): PaymentLinkDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.toLinkWithPaymentListDto);
  }

  static toPaymentDtoList(payment: PaymentLinkPayment[]): PaymentLinkPaymentDto[] {
    return payment.map(PaymentLinkDtoMapper.createPaymentLinkPaymentDto);
  }

  private static createPaymentLinkDto(paymentLink: PaymentLink): PaymentLinkDto {
    return {
      id: paymentLink.id,
      routeId: paymentLink.route.id,
      externalId: paymentLink.externalId,
      webhookUrl: paymentLink.webhookUrl ?? undefined,
      recipient: paymentLink.recipient,
      status: paymentLink.status,
      url: LightningHelper.createLnurlp(paymentLink.uniqueId),
      lnurl: LightningHelper.createEncodedLnurlp(paymentLink.uniqueId),
    };
  }

  private static createPaymentLinkPaymentDto(payment?: PaymentLinkPayment): PaymentLinkPaymentDto {
    return (
      payment && {
        id: payment.id,
        externalId: payment.externalId,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency.name,
        mode: payment.mode,
        expiryDate: payment.expiryDate,
        txCount: payment.txCount,
        url: LightningHelper.createLnurlp(payment.uniqueId),
        lnurl: LightningHelper.createEncodedLnurlp(payment.uniqueId),
      }
    );
  }
}
