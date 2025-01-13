import { groupBy, sumBy } from 'lodash';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { EvmUtil } from '../evm/evm.util';
import { FrankencoinBasedCollateralDto } from './frankencoin-based.dto';

export abstract class FrankencoinBasedService {
  private pricingService: PricingService;

  setup(pricingService: PricingService) {
    this.pricingService = pricingService;
  }

  async getPrice(from: Fiat, to: Fiat): Promise<Price> {
    return this.pricingService.getPrice(from, to, true);
  }

  async getTvlByCollaterals(collaterals: FrankencoinBasedCollateralDto[]): Promise<number> {
    const groupedCollaterals = groupBy(collaterals, (i) => i.collateral);

    const collateralsWithTotalBalances = Object.keys(groupedCollaterals).map((key) => {
      const first = groupedCollaterals[key][0];
      return {
        address: first.collateral,
        symbol: first.collateralSymbol,
        totalBalance: sumBy(groupedCollaterals[key], (i) =>
          EvmUtil.fromWeiAmount(i.collateralBalance, i.collateralDecimals),
        ),
      };
    });

    let tvl = 0;

    for (const collateralWithTotalBalance of collateralsWithTotalBalances) {
      const price = await this.pricingService.getPriceFrom(
        PriceSource.COIN_GECKO,
        collateralWithTotalBalance.address.toLowerCase(),
        'usd',
        'contract',
      );

      tvl += collateralWithTotalBalance.totalBalance / price.price;
    }

    return tvl;
  }
}
