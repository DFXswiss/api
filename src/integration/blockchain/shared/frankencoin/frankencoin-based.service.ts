import { Contract } from 'ethers';
import { groupBy, sumBy } from 'lodash';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
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
  protected readonly logger = new DfxLogger(this.constructor.name);

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
  abstract getWrapperContract(): Contract;
  abstract getEquityPrice(): Promise<number>;
  abstract getWalletAddress(): string;

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
      let collateralPrice = await this.getCustomCollateralPrice(collateralWithTotalBalance);

      if (!collateralPrice) collateralPrice = await this.getCoinGeckoPrice(collateralWithTotalBalance.address);

      if (collateralPrice) tvl += collateralWithTotalBalance.totalBalance / collateralPrice;
    }

    return tvl;
  }

  async getCoinGeckoPrice(contractaddress: string): Promise<number | undefined> {
    try {
      const price = await this.pricingService.getPriceFrom(
        PriceSource.COIN_GECKO,
        contractaddress.toLowerCase(),
        'usd',
        'contract',
      );

      if (price) return price.price;
    } catch (e) {
      this.logger.error(`Failed to get price for collateral ${contractaddress}:`, e);
    }
  }

  abstract getCustomCollateralPrice(collateral: CollateralWithTotalBalance): Promise<number | undefined>;
}
