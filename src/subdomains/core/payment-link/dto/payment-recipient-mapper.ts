import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { Sell } from 'src/subdomains/core/sell-crypto/route/sell.entity';
import { PaymentRecipientDto } from './payment-recipient.dto';

export class PaymentRecipientMapper {
  static toDto(sell: Sell): PaymentRecipientDto {
    return {
      id: sell.id,
      currency: FiatDtoMapper.toDto(sell.fiat),
    };
  }
}
