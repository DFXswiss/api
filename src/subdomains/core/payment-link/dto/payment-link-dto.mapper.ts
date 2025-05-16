import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkBaseDto, PaymentLinkDto, PaymentLinkHistoryDto, PaymentLinkPaymentDto } from './payment-link.dto';

export class PaymentLinkDtoMapper {
  static toLinkDto(paymentLink: PaymentLink): PaymentLinkDto {
    const dto = <PaymentLinkDto>PaymentLinkDtoMapper.createPaymentLinkBaseDto(paymentLink);
    dto.payment = PaymentLinkDtoMapper.createPaymentLinkPaymentDto(paymentLink.payments?.[0]);

    return Object.assign(new PaymentLinkDto(), dto);
  }

  static toLinkDtoList(paymentLinks: PaymentLink[]): PaymentLinkDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.toLinkDto);
  }

  static toLinkHistoryDto(paymentLink: PaymentLink): PaymentLinkHistoryDto {
    const dto = <PaymentLinkHistoryDto>PaymentLinkDtoMapper.createPaymentLinkBaseDto(paymentLink);
    dto.payments = PaymentLinkDtoMapper.toPaymentDtoList(paymentLink.payments);

    return Object.assign(new PaymentLinkHistoryDto(), dto);
  }

  static toLinkHistoryDtoList(paymentLinks: PaymentLink[]): PaymentLinkHistoryDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.toLinkHistoryDto);
  }

  static toPaymentDto(payment: PaymentLinkPayment): PaymentLinkPaymentDto {
    return PaymentLinkDtoMapper.createPaymentLinkPaymentDto(payment);
  }

  static toPaymentDtoList(payments: PaymentLinkPayment[]): PaymentLinkPaymentDto[] {
    return payments.map(PaymentLinkDtoMapper.createPaymentLinkPaymentDto);
  }

  private static createPaymentLinkBaseDto(paymentLink: PaymentLink): PaymentLinkBaseDto {
    return {
      id: paymentLink.id,
      routeId: paymentLink.route.id,
      externalId: paymentLink.externalId,
      label: paymentLink.label,
      webhookUrl: paymentLink.webhookUrl ?? undefined,
      recipient: paymentLink.recipient,
      status: paymentLink.status,
      config: paymentLink.configObj,
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
        isConfirmed: payment.isConfirmed,
        url: LightningHelper.createLnurlp(payment.uniqueId),
        lnurl: LightningHelper.createEncodedLnurlp(payment.uniqueId),
      }
    );
  }
}
