import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { DepositRoute } from 'src/subdomains/supporting/address-pool/route/deposit-route.entity';
import { isSellRoute } from '../../sell-crypto/route/sell.entity';
import { PaymentRecipientDto } from './payment-recipient.dto';

export class PaymentRecipientMapper {
  static toDto(route: DepositRoute): PaymentRecipientDto {
    return {
      id: route.id,
      currency: isSellRoute(route) ? FiatDtoMapper.toDto(route.fiat) : undefined,
    };
  }
}
