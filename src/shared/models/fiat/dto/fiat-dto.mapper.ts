import { Fiat } from '../fiat.entity';
import { FiatDto } from './fiat.dto';

export class FiatDtoMapper {
  static entityToDto(fiat: Fiat): FiatDto {
    const dto: FiatDto = {
      id: fiat.id,
      name: fiat.name,
      buyable: fiat.buyable,
      sellable: fiat.sellable,
    };

    return Object.assign(new FiatDto(), dto);
  }

  static entitiesToDto(fiatList: Fiat[]): FiatDto[] {
    const dto: FiatDto[] = [];
    for (const fiat of fiatList) {
      dto.push(this.entityToDto(fiat));
    }
    return dto;
  }
}
