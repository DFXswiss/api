import { Config } from 'src/config/config';
import { AmountType, Util } from 'src/shared/utils/util';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TxMinSpec } from 'src/subdomains/supporting/payment/dto/transaction-helper/tx-spec.dto';
import { Country } from '../../country/country.entity';
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

  static toDetailDto(fiat: Fiat, spec: TxMinSpec, countries: Country[]): FiatDetailDto {
    const allowedCountries = countries
      .filter((c) => c.dfxEnable && fiat.isIbanCountryAllowed(c.symbol))
      .map((c) => c.symbol);

    return Object.assign(this.toDto(fiat), {
      limits: {
        [FiatPaymentMethod.BANK]:
          fiat.buyable || fiat.sellable
            ? this.convert(spec.minVolume, Config.tradingLimits.yearlyDefault, fiat)
            : this.zeroLimits,
        [FiatPaymentMethod.INSTANT]:
          fiat.instantBuyable || fiat.instantSellable
            ? this.convert(spec.minVolume, Config.tradingLimits.yearlyDefault, fiat)
            : this.zeroLimits,
        [FiatPaymentMethod.CARD]:
          fiat.cardBuyable || fiat.cardSellable
            ? this.convert(spec.minVolume, Config.tradingLimits.cardDefault, fiat)
            : this.zeroLimits,
      },
      allowedIbanCountry: allowedCountries,
    });
  }

  private static convert(min: number, max: number, fiat: Fiat): VolumeLimitDto {
    const price = fiat.approxPriceChf ?? 1;

    return {
      minVolume: Util.roundReadable(min / price, AmountType.FIAT),
      maxVolume: Util.roundReadable(max / price, AmountType.FIAT),
    };
  }

  private static get zeroLimits(): VolumeLimitDto {
    return { minVolume: 0, maxVolume: 0 };
  }
}
