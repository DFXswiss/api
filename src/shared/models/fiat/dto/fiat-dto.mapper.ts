import { Config } from 'src/config/config';
import { TxSpec } from 'src/subdomains/supporting/payment/dto/tx-spec.dto';
import { Fiat } from '../fiat.entity';
import { FiatDetailDto, FiatDto } from './fiat.dto';

export class FiatDtoMapper {
  static toDto(fiat: Fiat): FiatDto {
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

  static toDetailDto(fiat: Fiat, spec: TxSpec): FiatDetailDto {
    return Object.assign(this.toDto(fiat), {
      minVolume: spec.minVolume,
      maxVolume: Config.defaultTradingLimit,
    });
  }
}
