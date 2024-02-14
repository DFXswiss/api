import { Fiat } from '../fiat.entity';
import { FiatDto } from './fiat.dto';

export class FiatDtoMapper {
  static entityToDto(fiat: Fiat): FiatDto {
    const dto: FiatDto = {
      id: fiat.id,
      name: fiat.name,
      buyable: fiat.buyable,
      sellable: fiat.sellable,
      cardBuyable: fiat.cardBuyable,
      cardSellable: fiat.cardSellable,
      instantBuyable: fiat.instantBuyable,
      instantSellable: fiat.instantSellable,
    };

    return Object.assign(new FiatDto(), dto);
  }

  static entitiesToDto(fiatList: Fiat[]): FiatDto[] {
    return fiatList.map(FiatDtoMapper.entityToDto);
  }
}
