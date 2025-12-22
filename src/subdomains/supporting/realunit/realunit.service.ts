import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { verifyTypedData } from 'ethers/lib/utils';
import { request } from 'graphql-request';
import { Config, GetConfig } from 'src/config/config';
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
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { Util } from 'src/shared/utils/util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { transliterate } from 'transliteration';
import { AssetPricesService } from '../pricing/services/asset-prices.service';
import { PriceCurrency, PriceValidity, PricingService } from '../pricing/services/pricing.service';
import {
  AccountHistoryClientResponse,
  AccountSummaryClientResponse,
  HoldersClientResponse,
  TokenInfoClientResponse,
} from './dto/client.dto';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import { AktionariatRegistrationDto, RealUnitRegistrationDto, RealUnitUserType } from './dto/realunit-registration.dto';
import {
  AccountHistoryDto,
  AccountSummaryDto,
  BankDetailsDto,
  HistoricalPriceDto,
  HoldersDto,
  RealUnitBuyDto,
  RealUnitPaymentInfoDto,
  TimeFrame,
  TokenInfoDto,
} from './dto/realunit.dto';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery, getTokenInfoQuery } from './utils/queries';
import { TimeseriesUtils } from './utils/timeseries-utils';

@Injectable()
export class RealUnitService {
  private readonly logger = new DfxLogger(RealUnitService);

  private readonly ponderUrl: string;
  private readonly genesisDate = new Date('2022-04-12 07:46:41.000');
  private readonly tokenName = 'REALU';
  private readonly historicalPriceCache = new AsyncCache<HistoricalPriceDto[]>(CacheItemResetPeriod.EVERY_6_HOURS);

  constructor(
    private readonly assetPricesService: AssetPricesService,
    private readonly pricingService: PricingService,
    private readonly assetService: AssetService,
    private readonly blockchainService: RealUnitBlockchainService,
    private readonly userDataService: UserDataService,
    private readonly userService: UserService,
    private readonly kycService: KycService,
    private readonly countryService: CountryService,
    private readonly languageService: LanguageService,
    private readonly http: HttpService,
    private readonly virtualIbanService: VirtualIbanService,
    private readonly fiatService: FiatService,
    private readonly swissQrService: SwissQRService,
    @Inject(forwardRef(() => BuyService))
    private readonly buyService: BuyService,
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

  // --- Buy Payment Info Methods ---

  async getPaymentInfo(user: User, dto: RealUnitBuyDto): Promise<RealUnitPaymentInfoDto> {
    const userData = user.userData;
    const currency = dto.currency ?? 'CHF';

    // 1. KYC Level 50 required for RealUnit
    if (userData.kycLevel < KycLevel.LEVEL_50) {
      throw new BadRequestException('KYC Level 50 required for RealUnit');
    }

    // 2. Registration required
    const hasRegistration = userData.getNonFailedStepWith(KycStepName.REALUNIT_REGISTRATION);
    if (!hasRegistration) {
      throw new BadRequestException('RealUnit registration required');
    }

    // 3. Get or create Buy route for REALU
    const realuAsset = await this.getRealuAsset();
    const buy = await this.buyService.createBuy(user, user.address, { asset: realuAsset }, true);

    // 4. Get or create vIBAN for this buy
    let virtualIban = await this.virtualIbanService.getActiveForBuyAndCurrency(buy.id, currency);
    if (!virtualIban) {
      virtualIban = await this.virtualIbanService.createForBuy(userData, buy, currency);
    }

    // 5. Calculate estimated shares
    const sharesInfo = await this.getBrokerbotShares(dto.amount.toString());

    // 6. Recipient info (RealUnit company address)
    const { bank: realunitBank } = GetConfig().blockchain.realunit;
    const recipientInfo = {
      name: realunitBank.recipient,
      street: 'Schochenmühlestrasse',
      number: '6',
      zip: '6340',
      city: 'Baar',
      country: 'Switzerland',
    };

    const bankInfo = {
      ...recipientInfo,
      iban: virtualIban.iban,
      bic: virtualIban.bank.bic,
    };

    let paymentRequest: string | undefined;
    if (currency === 'CHF') {
      paymentRequest = this.swissQrService.createQrCode(dto.amount, currency, undefined, bankInfo, userData);
    } else {
      paymentRequest = this.generateGiroCode(bankInfo, dto.amount, currency);
    }

    return {
      iban: virtualIban.iban,
      bic: virtualIban.bank.bic,
      name: recipientInfo.name,
      street: recipientInfo.street,
      number: recipientInfo.number,
      zip: recipientInfo.zip,
      city: recipientInfo.city,
      country: recipientInfo.country,
      amount: dto.amount,
      currency,
      estimatedShares: sharesInfo.shares,
      pricePerShare: sharesInfo.pricePerShare,
      paymentRequest,
    };
  }

  private generateGiroCode(
    bankInfo: { name: string; street: string; number: string; zip: string; city: string; country: string; iban: string; bic: string },
    amount: number,
    currency: string,
  ): string {
    return `
${Config.giroCode.service}
${Config.giroCode.version}
${Config.giroCode.encoding}
${Config.giroCode.transfer}
${bankInfo.bic}
${bankInfo.name}, ${bankInfo.street} ${bankInfo.number}, ${bankInfo.zip} ${bankInfo.city}, ${bankInfo.country}
${bankInfo.iban}
${currency}${amount}
${Config.giroCode.char}
${Config.giroCode.ref}
`.trim();
  }

  // --- Registration Methods ---

  // returns true if registration needs manual review, false if completed
  async register(userDataId: number, dto: RealUnitRegistrationDto): Promise<boolean> {
    // validate DTO
    await this.validateRegistrationDto(dto);

    // get and validate user
    const userData = await this.userService
      .getUserByAddress(dto.walletAddress, {
        userData: { kycSteps: true, users: true, country: true, organizationCountry: true },
      })
      .then((u) => u?.userData);

    if (!userData) throw new NotFoundException('User not found');
    if (userData.id !== userDataId) throw new BadRequestException('Wallet address does not belong to user');

    if (!userData.mail) throw new BadRequestException('User email not verified');
    if (!Util.equalsIgnoreCase(dto.email, userData.mail)) {
      throw new BadRequestException('Email does not match verified email');
    }

    // duplicate check
    if (userData.getNonFailedStepWith(KycStepName.REALUNIT_REGISTRATION)) {
      throw new BadRequestException('RealUnit registration already exists');
    }

    // store data with internal review
    const kycStep = await this.kycService.createCustomKycStep(
      userData,
      KycStepName.REALUNIT_REGISTRATION,
      ReviewStatus.INTERNAL_REVIEW,
      dto,
    );

    const hasExistingData = userData.firstname != null;
    if (hasExistingData) {
      const dataMatches = this.isPersonalDataMatching(userData, dto);
      if (!dataMatches) {
        await this.kycService.saveKycStepUpdate(kycStep.manualReview('Existing KYC data does not match'));
        return true;
      }
    } else {
      await this.userDataService.updatePersonalData(userData, dto.kycData);
    }

    // update always
    await this.userDataService.updateUserDataInternal(userData, {
      nationality: await this.countryService.getCountryWithSymbol(dto.nationality),
      birthday: new Date(dto.birthday),
      language: dto.lang && (await this.languageService.getLanguageBySymbol(dto.lang)),
      tin: dto.countryAndTINs?.length ? JSON.stringify(dto.countryAndTINs) : undefined,
    });

    // forward to Aktionariat
    const success = await this.forwardRegistration(kycStep, dto);
    return !success;
  }

  private async validateRegistrationDto(dto: RealUnitRegistrationDto): Promise<void> {
    // signature validation
    if (!this.verifyRealUnitRegistrationSignature(dto)) {
      throw new BadRequestException('Invalid signature');
    }

    // registration date validation - must be today
    const now = new Date();
    if (dto.registrationDate !== Util.isoDate(now)) {
      throw new BadRequestException('Registration date must be today');
    }

    // birthday validation - must be valid date, not in future, not older than 140 years
    const birthday = new Date(dto.birthday);
    if (isNaN(birthday.getTime())) throw new BadRequestException('Invalid birthday date');
    if (birthday > now) throw new BadRequestException('Birthday cannot be in the future');

    const maxAge = new Date(now);
    maxAge.setFullYear(maxAge.getFullYear() - 140);
    if (birthday < maxAge) throw new BadRequestException('Birthday cannot be more than 140 years ago');

    // data validation
    if (dto.kycData.accountType === AccountType.ORGANIZATION) {
      if (dto.type !== RealUnitUserType.CORPORATION) {
        throw new BadRequestException('ORGANIZATION accountType requires CORPORATION type');
      }

      // organization name
      if (dto.kycData.organizationName !== dto.name) {
        throw new BadRequestException('organizationName must match signed name');
      }

      // organization address
      const combinedOrgAddress = dto.kycData.organizationAddress.houseNumber
        ? `${dto.kycData.organizationAddress.street} ${dto.kycData.organizationAddress.houseNumber}`
        : dto.kycData.organizationAddress.street;
      if (combinedOrgAddress !== dto.addressStreet) {
        throw new BadRequestException('organizationAddress street + houseNumber must match signed addressStreet');
      }

      if (dto.kycData.organizationAddress.zip !== dto.addressPostalCode) {
        throw new BadRequestException('organizationAddress zip must match signed addressPostalCode');
      }

      if (dto.kycData.organizationAddress.city !== dto.addressCity) {
        throw new BadRequestException('organizationAddress city must match signed addressCity');
      }

      const orgCountry = await this.countryService.getCountry(dto.kycData.organizationAddress.country.id);
      if (orgCountry.symbol !== dto.addressCountry) {
        throw new BadRequestException('organizationAddress country must match signed addressCountry');
      }
    } else {
      if (dto.type !== RealUnitUserType.HUMAN) {
        throw new BadRequestException('Personal/SoleProprietorship accountType requires HUMAN type');
      }

      // personal name
      const combinedName = `${dto.kycData.firstName} ${dto.kycData.lastName}`;
      if (combinedName !== dto.name) {
        throw new BadRequestException('firstName + lastName does not match signed name');
      }

      // personal address
      const combinedAddress = dto.kycData.address.houseNumber
        ? `${dto.kycData.address.street} ${dto.kycData.address.houseNumber}`
        : dto.kycData.address.street;
      if (combinedAddress !== dto.addressStreet) {
        throw new BadRequestException('street + houseNumber does not match signed addressStreet');
      }
    }
  }

  private verifyRealUnitRegistrationSignature(data: RealUnitRegistrationDto): boolean {
    const domain = {
      name: 'RealUnitUser',
      version: '1',
    };

    const types = {
      RealUnitUser: [
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
    if (!kycStep) throw new NotFoundException('KYC step not found');
    if (kycStep.name !== KycStepName.REALUNIT_REGISTRATION) {
      throw new BadRequestException('KYC step is not a RealUnit registration');
    }
    if (kycStep.status !== ReviewStatus.MANUAL_REVIEW) {
      throw new BadRequestException('KYC step is not in MANUAL_REVIEW status');
    }

    const dto = kycStep.getResult<RealUnitRegistrationDto>();
    if (!dto) throw new BadRequestException('No registration data found');

    const success = await this.forwardRegistration(kycStep, dto);
    if (!success) throw new BadRequestException('Failed to forward registration to Aktionariat');
  }

  private isPersonalDataMatching(userData: UserData, dto: RealUnitRegistrationDto): boolean {
    const kycData = dto.kycData;

    if (transliterate(kycData.firstName) !== userData.firstname) return false;
    if (transliterate(kycData.lastName) !== userData.surname) return false;
    if (kycData.phone !== userData.phone) return false;
    if (kycData.accountType !== userData.accountType) return false;

    if (transliterate(kycData.address.street) !== userData.street) return false;
    if (transliterate(kycData.address.houseNumber ?? '') !== (userData.houseNumber ?? '')) return false;
    if (transliterate(kycData.address.city) !== userData.location) return false;
    if (transliterate(kycData.address.zip) !== userData.zip) return false;
    if (kycData.address.country?.id !== userData.country?.id) return false;

    if (kycData.accountType !== AccountType.PERSONAL) {
      if ((kycData.organizationName ?? null) !== (userData.organizationName ?? null)) return false;
      if ((kycData.organizationAddress?.street ?? null) !== (userData.organizationStreet ?? null)) return false;
      if ((kycData.organizationAddress?.houseNumber ?? null) !== (userData.organizationHouseNumber ?? null))
        return false;
      if ((kycData.organizationAddress?.city ?? null) !== (userData.organizationLocation ?? null)) return false;
      if ((kycData.organizationAddress?.zip ?? null) !== (userData.organizationZip ?? null)) return false;
      if ((kycData.organizationAddress?.country?.id ?? null) !== (userData.organizationCountry?.id ?? null))
        return false;
    }

    if (dto.nationality !== userData.nationality?.symbol) return false;
    if (dto.birthday !== Util.isoDate(userData.birthday)) return false;

    return true;
  }

  private async forwardRegistration(kycStep: KycStep, dto: RealUnitRegistrationDto): Promise<boolean> {
    const { api } = Config.blockchain.realunit;

    try {
      // forward only Aktionariat fields (exclude kycData to avoid signature verification issues)
      const payload: AktionariatRegistrationDto = {
        email: dto.email,
        name: dto.name,
        type: dto.type,
        phoneNumber: dto.phoneNumber,
        birthday: dto.birthday,
        nationality: dto.nationality,
        addressStreet: dto.addressStreet,
        addressPostalCode: dto.addressPostalCode,
        addressCity: dto.addressCity,
        addressCountry: dto.addressCountry,
        swissTaxResidence: dto.swissTaxResidence,
        registrationDate: dto.registrationDate,
        walletAddress: dto.walletAddress,
        signature: dto.signature,
        lang: dto.lang,
        countryAndTINs: dto.countryAndTINs,
      };

      await this.http.post(`${api.url}/registerUser`, payload, {
        headers: { 'x-api-key': api.key },
      });

      await this.kycService.saveKycStepUpdate(kycStep.complete());
      return true;
    } catch (error) {
      const message = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error;

      this.logger.error(
        `Failed to forward RealUnit registration to Aktionariat for KYC step ${kycStep.id}: ${message}`,
      );
      await this.kycService.saveKycStepUpdate(kycStep.manualReview(message));
      return false;
    }
  }
}
