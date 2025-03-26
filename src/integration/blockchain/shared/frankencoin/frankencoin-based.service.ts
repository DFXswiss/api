import { Contract } from 'ethers';
import { groupBy, sumBy } from 'lodash';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PriceSource } from 'src/subdomains/supporting/pricing/domain/entities/price-rule.entity';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { CollateralWithTotalBalance } from '../dto/frankencoin-based.dto';
import { Blockchain } from '../enums/blockchain.enum';
import { EvmClient } from '../evm/evm-client';
import { EvmUtil } from '../evm/evm.util';
import { BlockchainRegistryService } from '../services/blockchain-registry.service';
import { FrankencoinBasedCollateralDto } from './frankencoin-based.dto';

export abstract class FrankencoinBasedService {
  private pricingService: PricingService;
  private registryService: BlockchainRegistryService;

  getEvmClient(): EvmClient {
    return this.registryService.getClient(Blockchain.ETHEREUM) as EvmClient;
  }

  setup(pricingService: PricingService, registryService: BlockchainRegistryService) {
    this.pricingService = pricingService;
    this.registryService = registryService;
  }

  abstract getEquityContract(): Contract;
  abstract getEquityPrice(): Promise<number>;

  async getPrice(from: Fiat, to: Fiat): Promise<Price> {
    return this.pricingService.getPrice(from, to, true);
  }

  async getTvlByCollaterals(collaterals: FrankencoinBasedCollateralDto[]): Promise<number> {
    const groupedCollaterals = groupBy(collaterals, (i) => i.collateral);

    const collateralsWithTotalBalances: CollateralWithTotalBalance[] = Object.keys(groupedCollaterals).map((key) => {
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
      let collateralPrice = await this.getCollateralPrice(collateralWithTotalBalance);

      if (!collateralPrice) collateralPrice = await this.getCoinGeckoPrice(collateralWithTotalBalance);

      if (collateralPrice) tvl += collateralWithTotalBalance.totalBalance / collateralPrice;
    }

    return tvl;
  }

  private async getCoinGeckoPrice(collateral: CollateralWithTotalBalance): Promise<number | undefined> {
    const price = await this.pricingService.getPriceFrom(
      PriceSource.COIN_GECKO,
      collateral.address.toLowerCase(),
      'usd',
      'contract',
    );

    if (price) return price.price;
  }

  abstract getCollateralPrice(collateral: CollateralWithTotalBalance): Promise<number | undefined>;
}
