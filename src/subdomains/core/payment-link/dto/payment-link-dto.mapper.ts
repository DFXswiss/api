import { Config } from 'src/config/config';
import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLinkConfig } from '../entities/payment-link.config';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkConfigDto } from './payment-link-config.dto';
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
    dto.totalCompletedAmount = paymentLink.totalCompletedAmount;

    return Object.assign(new PaymentLinkHistoryDto(), dto);
  }

  static toLinkHistoryDtoList(paymentLinks: PaymentLink[]): PaymentLinkHistoryDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.toLinkHistoryDto);
  }

  static toPaymentDto(payment: PaymentLinkPayment): PaymentLinkPaymentDto {
    return PaymentLinkDtoMapper.createPaymentLinkPaymentDto(payment);
  }

  static toPaymentDtoList(payments?: PaymentLinkPayment[]): PaymentLinkPaymentDto[] {
    return payments?.map(PaymentLinkDtoMapper.createPaymentLinkPaymentDto) ?? [];
  }

  static toConfigDto(config: PaymentLinkConfig): PaymentLinkConfigDto | null {
    if (!config) return null;

    return {
      standards: config.standards,
      blockchains: config.blockchains,
      minCompletionStatus: config.minCompletionStatus,
      displayQr: config.displayQr,
      fee: config.fee,
      recipient: config.recipient,
      scanTimeout: config.scanTimeout,
      paymentTimeout: config.paymentTimeout,
    };
  }

  private static createPaymentLinkBaseDto(paymentLink: PaymentLink): PaymentLinkBaseDto {
    const lightning = LightningHelper.createEncodedLnurlp(paymentLink.uniqueId);

    return {
      id: paymentLink.id,
      routeId: paymentLink.route.id,
      externalId: paymentLink.externalId,
      label: paymentLink.label,
      webhookUrl: paymentLink.webhookUrl ?? undefined,
      recipient: paymentLink.configObj.recipient,
      status: paymentLink.status,
      config: PaymentLinkDtoMapper.toConfigDto(paymentLink.configObj),
      url: LightningHelper.createLnurlp(paymentLink.uniqueId),
      lnurl: lightning,
      frontendUrl: `${Config.frontend.services}/pl?${new URLSearchParams({ lightning })}`,
      mode: paymentLink.mode,
    };
  }

  private static createPaymentLinkPaymentDto(payment?: PaymentLinkPayment): PaymentLinkPaymentDto {
    const lightning = payment && LightningHelper.createEncodedLnurlp(payment.uniqueId);

    return (
      payment && {
        id: payment.id,
        externalId: payment.externalId,
        note: payment.note,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency.name,
        mode: payment.mode,
        date: payment.created,
        expiryDate: payment.expiryDate,
        txCount: payment.txCount,
        isConfirmed: payment.isConfirmed,
        url: LightningHelper.createLnurlp(payment.uniqueId),
        lnurl: lightning,
        frontendUrl: `${Config.frontend.services}/pl?${new URLSearchParams({ lightning })}`,
      }
    );
  }
}
