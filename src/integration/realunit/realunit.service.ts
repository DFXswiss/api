import { Injectable } from '@nestjs/common';
import { request } from 'graphql-request';
import { GetConfig } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Blockchain } from '../blockchain/shared/enums/blockchain.enum';
import { AccountHistoryClientResponse, AccountSummaryClientResponse, HoldersClientResponse } from './dto/client.dto';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import { AccountHistoryDto, AccountSummaryDto, HistoricalPriceDto, HoldersDto, TimeFrame } from './dto/realunit.dto';
import { PriceUtils } from './utils/price-utils';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery } from './utils/queries';

@Injectable()
export class RealUnitService {
  private readonly ponderUrl: string;
  private readonly genesisDate = new Date('2022-04-12 07:46:41.000');
  private readonly tokenName = 'REALU';
  private static readonly ZCHF = 'ZCHF';
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

  async getHolders(first?: number, after?: string): Promise<HoldersDto> {
    const holdersQuery = getHoldersQuery(first, after);
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
    const price = await this.pricingService.realunitService.getPrice(RealUnitService.ZCHF, this.tokenName);
    return RealUnitDtoMapper.priceToHistoricalPriceDto(price);
  }

  private async getHistoricalPriceStartDate(timeFrame: TimeFrame): Promise<Date> {
    const now = new Date();
    switch (timeFrame) {
      case TimeFrame.MONTH:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case TimeFrame.YEAR:
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      case TimeFrame.ALL:
        return this.genesisDate;
      default: // WEEK
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
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
}
