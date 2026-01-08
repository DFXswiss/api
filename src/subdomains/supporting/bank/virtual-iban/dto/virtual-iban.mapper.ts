import { VirtualIban } from '../virtual-iban.entity';
import { VirtualIbanDto } from './virtual-iban.dto';

export class VirtualIbanMapper {
  static toDto(virtualIban: VirtualIban): VirtualIbanDto {
    const dto: VirtualIbanDto = {
      id: virtualIban.id,
      iban: virtualIban.iban,
      bban: virtualIban.bban,
      currency: virtualIban.currency.name,
      active: virtualIban.active,
      status: virtualIban.status,
      label: virtualIban.label,
      activatedAt: virtualIban.activatedAt,
    };

    return Object.assign(new VirtualIbanDto(), dto);
  }
}
