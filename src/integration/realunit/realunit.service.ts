import { Injectable } from '@nestjs/common';
import { request } from 'graphql-request';
import { GetConfig } from 'src/config/config';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { Util } from 'src/shared/utils/util';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { AssetPricesService } from 'src/subdomains/supporting/pricing/services/asset-prices.service';
import {
  PriceCurrency,
  PriceValidity,
  PricingService,
} from 'src/subdomains/supporting/pricing/services/pricing.service';
import { Blockchain } from '../blockchain/shared/enums/blockchain.enum';
import { RealUnitBlockchainService } from '../blockchain/realunit/realunit-blockchain.service';
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
  BankDetailsDto,
  BrokerbotBroadcastResponse,
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSellPriceDto,
  BrokerbotSellTxDto,
  BrokerbotSharesDto,
  HistoricalPriceDto,
  HoldersDto,
  Permit2ApprovalDto,
  Permit2ApproveTxDto,
  RealUnitAtomicSellResponse,
  RealUnitPermitDto,
  TimeFrame,
  TokenInfoDto,
} from './dto/realunit.dto';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery, getTokenInfoQuery } from './utils/queries';
import { TimeseriesUtils } from './utils/timeseries-utils';

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
    private readonly blockchainService: RealUnitBlockchainService,
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
    return this.blockchainService.getBrokerbotPrice();
  }

  async getBrokerbotBuyPrice(shares: number): Promise<BrokerbotBuyPriceDto> {
    return this.blockchainService.getBrokerbotBuyPrice(shares);
  }

  async getBrokerbotSellPrice(shares: number): Promise<BrokerbotSellPriceDto> {
    return this.blockchainService.getBrokerbotSellPrice(shares);
  }

  async getBrokerbotShares(amountChf: string): Promise<BrokerbotSharesDto> {
    return this.blockchainService.getBrokerbotShares(amountChf);
  }

  async getAllowlistStatus(address: string): Promise<AllowlistStatusDto> {
    return this.blockchainService.getAllowlistStatus(address);
  }

  async getBrokerbotInfo(): Promise<BrokerbotInfoDto> {
    return this.blockchainService.getBrokerbotInfo();
  }

  getBankDetails(): BankDetailsDto {
    const { bank } = GetConfig().blockchain.realunit;

    return {
      recipient: bank.recipient,
      address: bank.address,
      iban: bank.iban,
      bic: bank.bic,
      bankName: bank.name,
      currency: 'CHF',
    };
  }

  // --- Sell Methods ---

  /**
   * Prepares transaction data for client to sign
   */
  async prepareSellTx(shares: number, minPrice?: string): Promise<BrokerbotSellTxDto> {
    return this.blockchainService.prepareSellTx(shares, minPrice);
  }

  /**
   * Validates and broadcasts a signed Brokerbot sell transaction.
   * Returns the TX hash after confirmation.
   */
  async broadcastSellTx(signedTransaction: string): Promise<BrokerbotBroadcastResponse> {
    // 1. Validate and decode the signed TX
    const { shares } = await this.blockchainService.validateBrokerbotSellTx(signedTransaction);

    // 2. Get expected ZCHF output
    const sellPrice = await this.blockchainService.getBrokerbotSellPrice(shares);

    // 3. Broadcast and wait for confirmation
    const txHash = await this.blockchainService.broadcastSignedTransaction(signedTransaction);
    await this.blockchainService.waitForTransaction(txHash);

    return {
      txHash,
      shares,
      zchfReceived: sellPrice.totalProceeds,
    };
  }

  // --- Permit2 Approval Methods ---

  /**
   * Gets ZCHF allowance for Permit2 contract
   */
  async getPermit2Approval(address: string): Promise<Permit2ApprovalDto> {
    return this.blockchainService.getPermit2Approval(address);
  }

  /**
   * Prepares approve transaction for Permit2 contract
   */
  async prepareApproveTx(unlimited = true): Promise<Permit2ApproveTxDto> {
    return this.blockchainService.prepareApproveTx(unlimited);
  }

  // --- Atomic Sell Methods ---

  /**
   * Executes an atomic REALU sell:
   * 1. Validates Brokerbot TX and Permit2 signature
   * 2. Verifies amounts match
   * 3. Broadcasts Brokerbot TX (REALU → ZCHF)
   * 4. Executes Permit2 transfer (ZCHF → DFX)
   */
  async executeAtomicSell(
    signedBrokerbotTx: string,
    permit: RealUnitPermitDto,
  ): Promise<RealUnitAtomicSellResponse> {
    return this.blockchainService.executeAtomicSell(signedBrokerbotTx, permit);
  }
}
