import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { verifyTypedData } from 'ethers/lib/utils';
import { request } from 'graphql-request';
import { GetConfig } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import {
  AllowlistStatusDto,
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
} from 'src/integration/blockchain/realunit/dto/realunit-broker.dto';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { AssetPricesService } from '../pricing/services/asset-prices.service';
import { PriceCurrency, PriceValidity, PricingService } from '../pricing/services/pricing.service';
import {
  AccountHistoryClientResponse,
  AccountSummaryClientResponse,
  HoldersClientResponse,
  TokenInfoClientResponse,
} from './dto/client.dto';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import { RealUnitRegistrationDto, RealUnitUserType } from './dto/realunit-registration.dto';
import {
  AccountHistoryDto,
  AccountSummaryDto,
  BankDetailsDto,
  HistoricalPriceDto,
  HoldersDto,
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
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly kycService: KycService,
    private readonly countryService: CountryService,
    private readonly http: HttpService,
  ) {
    this.ponderUrl = GetConfig().blockchain.realunit.graphUrl;
  }

  async getAccount(address: string): Promise<AccountSummaryDto> {
    const accountSummaryQuery = getAccountSummaryQuery(address);
    const clientResponse = await request<AccountSummaryClientResponse>(this.ponderUrl, accountSummaryQuery);
    if (!clientResponse.account) throw new NotFoundException('Account not found');

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
    if (!clientResponse.account) throw new NotFoundException('Account not found');

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

  // --- Registration Methods ---

  /**
   * Register user for RealUnit
   * @returns true if registration needs manual review, false if completed
   */
  async register(userDataId: number, dto: RealUnitRegistrationDto): Promise<boolean> {
    // 1. User & wallet validation
    const userData = await this.userService
      .getUserByAddress(dto.walletAddress, { userData: { kycSteps: true } })
      .then((u) => u?.userData);

    if (!userData) throw new NotFoundException('User not found');
    if (userData.id !== userDataId) throw new BadRequestException('Wallet address does not belong to user');

    // 2. Email validation - user must have submitted email via KYC step first
    if (!userData.mail) throw new BadRequestException('User email not verified');
    if (!Util.equalsIgnoreCase(dto.email, userData.mail)) {
      throw new BadRequestException('Email does not match verified email');
    }

    // 3. Signature validation
    if (!this.verifyRealUnitRegistrationSignature(dto)) {
      throw new BadRequestException('Invalid signature');
    }

    // 4. Name parts validation (unsigned fields must match signed fields)
    const combinedName = `${dto.firstname} ${dto.surname}`;
    if (combinedName !== dto.name) {
      throw new BadRequestException('firstname + surname does not match signed name');
    }

    const combinedAddress = dto.houseNumber ? `${dto.street} ${dto.houseNumber}` : dto.street;
    if (combinedAddress !== dto.addressStreet) {
      throw new BadRequestException('street + houseNumber does not match signed addressStreet');
    }

    // 5. AccountType validation
    if (dto.accountType === AccountType.ORGANIZATION) {
      throw new BadRequestException('Organization accounts are not yet supported');
    }

    if (dto.type === RealUnitUserType.HUMAN && ![AccountType.PERSONAL, AccountType.SOLE_PROPRIETORSHIP].includes(dto.accountType)) {
      throw new BadRequestException('HUMAN type requires accountType Personal or SoleProprietorship');
    }

    // 6. Duplicate check
    if (userData.getNonFailedStepWith(KycStepName.REALUNIT_REGISTRATION)) {
      throw new BadRequestException('RealUnit registration already exists');
    }

    // 7. Store data with INTERNAL_REVIEW status
    const kycStep = await this.kycService.createCustomKycStep(
      userData,
      KycStepName.REALUNIT_REGISTRATION,
      ReviewStatus.INTERNAL_REVIEW,
      dto,
    );

    // 8. Auto-forward check: firstname must be NULL
    const canAutoForward = userData.firstname == null;

    if (!canAutoForward) {
      await this.kycService.saveKycStepUpdate(kycStep.manualReview('User has existing KYC data'));
      return true;
    }

    // 9. Forward to Aktionariat
    try {
      const { api } = GetConfig().blockchain.realunit;
      await this.http.post(`${api.url}/registerUser`, dto, {
        headers: { 'x-api-key': api.key },
      });

      await this.kycService.saveKycStepUpdate(kycStep.complete());

      // 10. Store personal data to userData
      const country = await this.countryService.getCountryWithSymbol(dto.addressCountry);
      await this.userDataService.updateUserDataInternal(userData, {
        firstname: dto.firstname,
        surname: dto.surname,
        street: dto.street,
        houseNumber: dto.houseNumber,
        location: dto.addressCity,
        zip: dto.addressPostalCode,
        country,
        phone: dto.phoneNumber,
        accountType: dto.accountType,
      });

      return false;
    } catch (e) {
      await this.kycService.saveKycStepUpdate(kycStep.manualReview(e.message ?? 'Aktionariat API error'));
      return true;
    }
  }

  private verifyRealUnitRegistrationSignature(data: RealUnitRegistrationDto): boolean {
    const domain = {
      name: 'RealUnitUser',
      version: '1',
    };

    const types = {
      RealUnitUserRegistration: [
        { name: 'email', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'phoneNumber', type: 'string' },
        { name: 'birthday', type: 'string' },
        { name: 'nationality', type: 'string' },
        { name: 'addressStreet', type: 'string' },
        { name: 'addressPostalCode', type: 'string' },
        { name: 'addressCity', type: 'string' },
        { name: 'addressCountry', type: 'string' },
        { name: 'swissTaxResidence', type: 'bool' },
        { name: 'registrationDate', type: 'string' },
        { name: 'walletAddress', type: 'address' },
      ],
    };

    const signatureToUse = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`;
    const recoveredAddress = verifyTypedData(domain, types, data, signatureToUse);

    return Util.equalsIgnoreCase(recoveredAddress, data.walletAddress);
  }

  async forwardRegistrationToAktionariat(kycStepId: number): Promise<void> {
    const kycStep = await this.kycService.getKycStepById(kycStepId);
    if (!kycStep) throw new NotFoundException('KycStep not found');

    if (kycStep.name !== KycStepName.REALUNIT_REGISTRATION)
      throw new BadRequestException('Invalid KycStep type');
    if (kycStep.status !== ReviewStatus.MANUAL_REVIEW)
      throw new BadRequestException('KycStep not in MANUAL_REVIEW status');

    const registrationData = kycStep.getResult<RealUnitRegistrationDto>();

    const { api } = GetConfig().blockchain.realunit;
    try {
      await this.http.post(`${api.url}/registerUser`, registrationData, {
        headers: { 'x-api-key': api.key },
      });

      await this.kycService.saveKycStepUpdate(kycStep.complete());
    } catch (e) {
      const errorMessage = e.message ?? 'Failed to forward to Aktionariat';
      await this.kycService.saveKycStepUpdate(kycStep.manualReview(errorMessage));
      throw e;
    }
  }
}
