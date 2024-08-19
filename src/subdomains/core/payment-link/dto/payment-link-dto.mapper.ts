import { LightningHelper } from 'src/integration/lightning/lightning-helper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { PaymentLinkPayment } from '../entities/payment-link-payment.entity';
import { PaymentLink } from '../entities/payment-link.entity';
import { PaymentLinkDto, PaymentLinkPaymentDto, PaymentLinkRecipientDto } from './payment-link.dto';

export class PaymentLinkDtoMapper {
  static toLinkDto(paymentLink: PaymentLink): PaymentLinkDto {
    const dto: PaymentLinkDto = {
      id: paymentLink.id,
      routeId: paymentLink.route.id,
      externalId: paymentLink.externalId,
      webhookUrl: paymentLink.webhookUrl ?? undefined,
      recipient: PaymentLinkDtoMapper.toRecipientDto(paymentLink),
      status: paymentLink.status,
      payment: PaymentLinkDtoMapper.toPaymentDto(paymentLink.payments?.[0]),
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

  static toRecipientDto(paymentLink: PaymentLink): PaymentLinkRecipientDto | undefined {
    if (paymentLink.hasRecipient) {
      return {
        name: paymentLink.name,
        address: {
          street: paymentLink.street,
          houseNumber: paymentLink.houseNumber,
          zip: paymentLink.zip,
          city: paymentLink.city,
          country: paymentLink.country?.name,
        },
        phone: paymentLink.phone,
        mail: paymentLink.mail,
        website: paymentLink.website,
      };
    }

    const userData = paymentLink.route?.userData;

    if (userData) {
      return {
        name: `${userData.firstname} ${userData.surname}`,
        address: {
          street: userData.street,
          houseNumber: userData.houseNumber,
          zip: userData.zip,
          city: userData.location,
          country: userData.country?.name,
        },
        phone: userData.phone,
        mail: userData.mail,
        website: null,
      };
    }
  }
}
