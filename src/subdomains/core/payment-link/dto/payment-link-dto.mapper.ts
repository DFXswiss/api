import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkDto, PaymentLinkPaymentDto } from './payment-link.dto';

export class PaymentLinkDtoMapper {
  static toLinkDto(paymentLink: PaymentLink): PaymentLinkDto {
    const dto: PaymentLinkDto = {
      id: paymentLink.id,
      routeId: paymentLink.route.id,
      externalId: paymentLink.externalId,
      status: paymentLink.status,
      payment: PaymentLinkDtoMapper.toPaymentDto(paymentLink.currentPayment),
      url: LightningHelper.createLnurlp(paymentLink.uniqueId),
      lnurl: LightningHelper.createEncodedLnurlp(paymentLink.uniqueId),
    };

    return Object.assign(new PaymentLinkDto(), dto);
  }

  static toLinkDtoList(paymentLinks: PaymentLink[]): PaymentLinkDto[] {
    return paymentLinks.map(PaymentLinkDtoMapper.toLinkDto);
  }

  static toPaymentDto(payment?: PaymentLinkPayment): PaymentLinkPaymentDto {
    return (
      payment && {
        id: payment.id,
        externalId: payment.externalId,
        status: payment.status,
        amount: payment.amount,
        currency: FiatDtoMapper.toDto(payment.currency),
        mode: payment.mode,
        expiryDate: payment.expiryDate,
        url: LightningHelper.createLnurlp(payment.uniqueId),
        lnurl: LightningHelper.createEncodedLnurlp(payment.uniqueId),
      }
    );
  }
}
