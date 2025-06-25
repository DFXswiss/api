import { Contract } from 'ethers';
import { groupBy, sumBy } from 'lodash';
import { DfxLogger } from 'src/logger/dfx-logger.service';
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
  protected abstract readonly logger: DfxLogger;

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
    const collateralsWithTotalBalances = this.aggregateCollateralBalances(collaterals);

    let tvl = 0;

    for (const collateral of collateralsWithTotalBalances) {
      const price = await this.getCollateralPrice(collateral);
      if (price) tvl += collateral.totalBalance / price;
    }

    return tvl;
  }

  private aggregateCollateralBalances(collaterals: FrankencoinBasedCollateralDto[]): CollateralWithTotalBalance[] {
    const groupedCollaterals = groupBy(collaterals, (i) => i.collateral);

    return Object.keys(groupedCollaterals).map((key) => {
      const first = groupedCollaterals[key][0];
      return {
        address: first.collateral,
        symbol: first.collateralSymbol,
        totalBalance: sumBy(groupedCollaterals[key], (i) =>
          EvmUtil.fromWeiAmount(i.collateralBalance, i.collateralDecimals),
        ),
      };
    });
  }

  private async getCollateralPrice(collateral: CollateralWithTotalBalance): Promise<number | undefined> {
    try {
      const customPrice = await this.getCustomCollateralPrice(collateral);
      if (customPrice) return customPrice;

      return await this.getCoinGeckoPrice(collateral.address);
    } catch (e) {
      this.logger.error(`Failed to get price for collateral ${collateral.symbol} (${collateral.address}):`, e);
      return undefined;
    }
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
      this.logger.error(`Failed to get CoinGecko price for collateral ${contractaddress}:`, e);
    }
  }

  abstract getCustomCollateralPrice(collateral: CollateralWithTotalBalance): Promise<number | undefined>;
}
