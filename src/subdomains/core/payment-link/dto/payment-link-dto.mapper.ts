import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkDto, PaymentLinkPaymentStatus } from './payment-link.dto';

export class PaymentLinkDtoMapper {
  static entityToDto(paymentLink: PaymentLink): PaymentLinkDto {
    const paymentLinkPayment = paymentLink.payments.find((p) => p.status == PaymentLinkPaymentStatus.PENDING);
    const dto: PaymentLinkDto = {
      id: paymentLink.id,
      routeId: paymentLink.route.id,
      uniqueId: paymentLink.uniqueId,
      externalId: paymentLink.externalId,
      status: paymentLink.status,
      payment: paymentLinkPayment
        ? {
            id: paymentLinkPayment.id,
            uniqueId: paymentLinkPayment.uniqueId,
            externalId: paymentLinkPayment.externalId,
            status: paymentLinkPayment.status,
            amount: paymentLinkPayment.amount,
            currency: FiatDtoMapper.toDto(paymentLinkPayment.currency),
            mode: paymentLinkPayment.mode,
            expiryDate: paymentLinkPayment.expiryDate,
          }
        : undefined,
    };

    return Object.assign(new PaymentLinkDto(), dto);
  }

  static entitiesToDto(paymentLinks: PaymentLink[]): PaymentLinkDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.entityToDto);
  }
}
