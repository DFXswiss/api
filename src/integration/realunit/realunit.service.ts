import { Injectable } from '@nestjs/common';
import { request } from 'graphql-request';
import { GetConfig } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Blockchain } from '../blockchain/shared/enums/blockchain.enum';
import {
  AccountHistoryClientResponse,
  AccountSummaryClientResponse,
  HoldersClientResponse,
  TokenInfoClientResponse,
} from './dto/client.dto';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import {
  AccountHistoryDto,
  AccountSummaryDto,
  HistoricalPriceDto,
  HoldersDto,
  TimeFrame,
  TokenInfoDto,
} from './dto/realunit.dto';
import { PriceUtils } from './utils/price-utils';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery, getTokenInfoQuery } from './utils/queries';

@Injectable()
export class RealUnitService {
  private readonly ponderUrl: string;
  private readonly genesisDate = new Date('2022-04-12 07:46:41.000');
  private readonly tokenName = 'REALU';
  private readonly historicalPriceCache = new AsyncCache<HistoricalPriceDto[]>(CacheItemResetPeriod.EVERY_6_HOURS);

  constructor(
    private readonly assetPricesService: AssetPricesService,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
  ) {
    this.ponderUrl = GetConfig().blockchain.realunit.graphUrl;
  }

  async getAccount(address: string): Promise<AccountSummaryDto> {
    const accountSummaryQuery = getAccountSummaryQuery(address);
    const clientResponse = await request<AccountSummaryClientResponse>(this.ponderUrl, accountSummaryQuery);
    const historicalPrices = await this.getHistoricalPrice(TimeFrame.ALL);

    return RealUnitDtoMapper.toAccountSummaryDto(clientResponse, historicalPrices);
  }

  async getHolders(first?: number, before?: string, after?: string): Promise<HoldersDto> {
    const holdersQuery = getHoldersQuery(first, before, after);
    const clientResponse = await request<HoldersClientResponse>(this.ponderUrl, holdersQuery);
    return RealUnitDtoMapper.toHoldersDto(clientResponse);
  }

  async getAccountHistory(address: string, first?: number, after?: string): Promise<AccountHistoryDto> {
    const accountHistoryQuery = getAccountHistoryQuery(address, first, after);
    const clientResponse = await request<AccountHistoryClientResponse>(this.ponderUrl, accountHistoryQuery);
    return RealUnitDtoMapper.toAccountHistoryDto(clientResponse);
  }

  private async getRealuAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: this.tokenName,
      blockchain: Blockchain.ETHEREUM,
      type: AssetType.TOKEN,
    });
  }

  async getRealUnitPrice(): Promise<HistoricalPriceDto> {
    const realuAsset = await this.getRealuAsset();

    const [chfPrice, eurPrice, usdPrice] = await Promise.all([
      this.pricingService.getPrice(PriceCurrency.CHF, realuAsset, PriceValidity.ANY).catch(() => null),
      this.pricingService.getPrice(PriceCurrency.EUR, realuAsset, PriceValidity.ANY).catch(() => null),
      this.pricingService.getPrice(PriceCurrency.USD, realuAsset, PriceValidity.ANY).catch(() => null),
    ]);

    return RealUnitDtoMapper.priceToHistoricalPriceDto(chfPrice, eurPrice, usdPrice);
  }

  private async getHistoricalPriceStartDate(timeFrame: TimeFrame): Promise<Date> {
    switch (timeFrame) {
      case TimeFrame.MONTH:
        return Util.daysBefore(30);
      case TimeFrame.YEAR:
        return Util.daysBefore(365);
      case TimeFrame.QUARTER:
        return Util.daysBefore(90);
      case TimeFrame.ALL:
        return this.genesisDate;
      default: // WEEK
        return Util.daysBefore(7);
    }
  }

  async getHistoricalPrice(timeFrame: TimeFrame): Promise<HistoricalPriceDto[]> {
    return this.historicalPriceCache.get(timeFrame, async () => {
      const startDate = await this.getHistoricalPriceStartDate(timeFrame);
      const prices = await this.assetPricesService.getAssetPrices([await this.getRealuAsset()], startDate);
      const filledPrices = PriceUtils.fillMissingDates(prices);
      return RealUnitDtoMapper.assetPricesToHistoricalPricesDto(filledPrices);
    });
  }

  async getRealUnitInfo(): Promise<TokenInfoDto> {
    const tokenInfoQuery = getTokenInfoQuery();
    const clientResponse = await request<TokenInfoClientResponse>(this.ponderUrl, tokenInfoQuery);
    return RealUnitDtoMapper.toTokenInfoDto(clientResponse);
  }
}
