import { Config } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TxSpec } from 'src/subdomains/supporting/payment/dto/tx-spec.dto';
import { Fiat } from '../fiat.entity';
import { FiatDetailDto, FiatDto, VolumeLimitDto } from './fiat.dto';

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
      limits: {
        [FiatPaymentMethod.BANK]: this.convert(spec.minVolume, Config.defaultTradingLimit, fiat),
        [FiatPaymentMethod.INSTANT]: this.convert(spec.minVolume, Config.defaultTradingLimit, fiat),
        [FiatPaymentMethod.CARD]: this.convert(spec.minVolume, Config.defaultCardTradingLimit, fiat),
      },
    });
  }

  private static convert(min: number, max: number, fiat: Fiat): VolumeLimitDto {
    const price = fiat.approxPriceChf ?? 1;

    return {
      minVolume: Util.round(min / price, 2),
      maxVolume: Util.round(max / price, 2),
    };
  }
}
