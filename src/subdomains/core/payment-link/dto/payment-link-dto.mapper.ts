import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkDto, PaymentLinkPaymentStatus } from './payment-link.dto';

export class PaymentLinkDtoMapper {
  static entityToDto(paymentLink: PaymentLink): PaymentLinkDto {
    const pendingPayment = paymentLink.payments.find((p) => p.status === PaymentLinkPaymentStatus.PENDING);

    const dto: PaymentLinkDto = {
      id: paymentLink.id,
      routeId: paymentLink.route.id,
      externalId: paymentLink.externalId,
      status: paymentLink.status,
      payment: pendingPayment
        ? {
            id: pendingPayment.id,
            externalId: pendingPayment.externalId,
            status: pendingPayment.status,
            amount: pendingPayment.amount,
            currency: FiatDtoMapper.toDto(pendingPayment.currency),
            mode: pendingPayment.mode,
            expiryDate: pendingPayment.expiryDate,
            url: LightningHelper.createLnurlp(pendingPayment.uniqueId),
            lnurl: LightningHelper.createEncodedLnurlp(pendingPayment.uniqueId),
          }
        : undefined,
      url: LightningHelper.createLnurlp(paymentLink.uniqueId),
      lnurl: LightningHelper.createEncodedLnurlp(paymentLink.uniqueId),
    };

    return Object.assign(new PaymentLinkDto(), dto);
  }

  static entitiesToDto(paymentLinks: PaymentLink[]): PaymentLinkDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.entityToDto);
  }
}
