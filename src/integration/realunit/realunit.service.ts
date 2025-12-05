import { Injectable } from '@nestjs/common';
import { Contract, ethers } from 'ethers';
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
  AllowlistStatusDto,
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
  HistoricalPriceDto,
  HoldersDto,
  TimeFrame,
  TokenInfoDto,
} from './dto/realunit.dto';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery, getTokenInfoQuery } from './utils/queries';
import { TimeseriesUtils } from './utils/timeseries-utils';

// Contract ABIs
const BROKERBOT_ABI = [
  'function getPrice() public view returns (uint256)',
  'function getBuyPrice(uint256 shares) public view returns (uint256)',
  'function getShares(uint256 money) public view returns (uint256)',
  'function token() public view returns (address)',
  'function base() public view returns (address)',
  'function settings() public view returns (uint256)',
];

const REALU_TOKEN_ABI = [
  'function canReceiveFromAnyone(address account) public view returns (bool)',
  'function isForbidden(address account) public view returns (bool)',
  'function isPowerlisted(address account) public view returns (bool)',
];

// Contract addresses
const BROKERBOT_ADDRESS = '0xcff32c60b87296b8c0c12980de685bed6cb9dd6d';
const REALU_TOKEN_ADDRESS = '0x553C7f9C780316FC1D34b8e14ac2465Ab22a090B';
const ZCHF_ADDRESS = '0xb58e61c3098d85632df34eecfb899a1ed80921cb';

@Injectable()
export class RealUnitService {
  private readonly ponderUrl: string;
  private readonly genesisDate = new Date('2022-04-12 07:46:41.000');
  private readonly tokenName = 'REALU';
  private readonly historicalPriceCache = new AsyncCache<HistoricalPriceDto[]>(CacheItemResetPeriod.EVERY_6_HOURS);

  private readonly provider: ethers.providers.JsonRpcProvider;
  private readonly brokerbotContract: Contract;
  private readonly realuTokenContract: Contract;

  constructor(
    private readonly assetPricesService: AssetPricesService,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
  ) {
    this.ponderUrl = GetConfig().blockchain.realunit.graphUrl;

    // Initialize Ethereum provider and contracts
    const { ethGatewayUrl, ethApiKey } = GetConfig().blockchain.ethereum;
    this.provider = new ethers.providers.JsonRpcProvider(`${ethGatewayUrl}/${ethApiKey}`);
    this.brokerbotContract = new Contract(BROKERBOT_ADDRESS, BROKERBOT_ABI, this.provider);
    this.realuTokenContract = new Contract(REALU_TOKEN_ADDRESS, REALU_TOKEN_ABI, this.provider);
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
      this.pricingService.getPrice(realuAsset, PriceCurrency.CHF, PriceValidity.ANY).catch(() => null),
      this.pricingService.getPrice(realuAsset, PriceCurrency.EUR, PriceValidity.ANY).catch(() => null),
      this.pricingService.getPrice(realuAsset, PriceCurrency.USD, PriceValidity.ANY).catch(() => null),
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
      const filledPrices = TimeseriesUtils.fillMissingDates(prices);
      return RealUnitDtoMapper.assetPricesToHistoricalPricesDto(filledPrices);
    });
  }

  async getRealUnitInfo(): Promise<TokenInfoDto> {
    const tokenInfoQuery = getTokenInfoQuery();
    const clientResponse = await request<TokenInfoClientResponse>(this.ponderUrl, tokenInfoQuery);
    return RealUnitDtoMapper.toTokenInfoDto(clientResponse);
  }

  // --- Brokerbot Methods ---

  async getBrokerbotPrice(): Promise<BrokerbotPriceDto> {
    const priceRaw = await this.brokerbotContract.getPrice();
    return {
      pricePerShare: ethers.utils.formatUnits(priceRaw, 18),
      pricePerShareRaw: priceRaw.toString(),
    };
  }

  async getBrokerbotBuyPrice(shares: number): Promise<BrokerbotBuyPriceDto> {
    const totalPriceRaw = await this.brokerbotContract.getBuyPrice(shares);
    const pricePerShareRaw = await this.brokerbotContract.getPrice();

    return {
      shares,
      totalPrice: ethers.utils.formatUnits(totalPriceRaw, 18),
      totalPriceRaw: totalPriceRaw.toString(),
      pricePerShare: ethers.utils.formatUnits(pricePerShareRaw, 18),
    };
  }

  async getBrokerbotShares(amountChf: string): Promise<BrokerbotSharesDto> {
    const amountWei = ethers.utils.parseUnits(amountChf, 18);
    const shares = await this.brokerbotContract.getShares(amountWei);
    const pricePerShareRaw = await this.brokerbotContract.getPrice();

    return {
      amount: amountChf,
      shares: shares.toNumber(),
      pricePerShare: ethers.utils.formatUnits(pricePerShareRaw, 18),
    };
  }

  async getAllowlistStatus(address: string): Promise<AllowlistStatusDto> {
    const [canReceive, isForbidden, isPowerlisted] = await Promise.all([
      this.realuTokenContract.canReceiveFromAnyone(address),
      this.realuTokenContract.isForbidden(address),
      this.realuTokenContract.isPowerlisted(address),
    ]);

    return {
      address,
      canReceive,
      isForbidden,
      isPowerlisted,
    };
  }

  async getBrokerbotInfo(): Promise<BrokerbotInfoDto> {
    const [priceRaw, settings] = await Promise.all([
      this.brokerbotContract.getPrice(),
      this.brokerbotContract.settings(),
    ]);

    // Settings bitmask: bit 0 = buying enabled, bit 1 = selling enabled
    const buyingEnabled = (settings.toNumber() & 1) === 1;
    const sellingEnabled = (settings.toNumber() & 2) === 2;

    return {
      brokerbotAddress: BROKERBOT_ADDRESS,
      tokenAddress: REALU_TOKEN_ADDRESS,
      baseCurrencyAddress: ZCHF_ADDRESS,
      pricePerShare: ethers.utils.formatUnits(priceRaw, 18),
      buyingEnabled,
      sellingEnabled,
    };
  }
}
