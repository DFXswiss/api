import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { verifyTypedData } from 'ethers/lib/utils';
import { request } from 'graphql-request';
import { Config, Environment, GetConfig } from 'src/config/config';
import {
  BrokerbotBuyPriceDto,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSharesDto,
} from 'src/integration/blockchain/realunit/dto/realunit-broker.dto';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
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
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
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
import {
  AktionariatRegistrationDto,
  RealUnitEmailRegistrationDto,
  RealUnitEmailRegistrationStatus,
  RealUnitRegistrationDto,
  RealUnitRegistrationStatus,
  RealUnitUserType,
} from './dto/realunit-registration.dto';
import { RealUnitSellConfirmDto, RealUnitSellDto, RealUnitSellPaymentInfoDto } from './dto/realunit-sell.dto';
import {
  AccountHistoryDto,
  AccountSummaryDto,
  HistoricalPriceDto,
  HoldersDto,
  RealUnitBuyDto,
  RealUnitPaymentInfoDto,
  TimeFrame,
  TokenInfoDto,
} from './dto/realunit.dto';
import { KycLevelRequiredException, RegistrationRequiredException } from './exceptions/buy-exceptions';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery, getTokenInfoQuery } from './utils/queries';
import { TimeseriesUtils } from './utils/timeseries-utils';

@Injectable()
export class RealUnitService {
  private readonly logger = new DfxLogger(RealUnitService);

  private readonly ponderUrl: string;
  private readonly genesisDate = new Date('2022-04-12 07:46:41.000');
  private readonly tokenName = 'REALU';
  private readonly tokenBlockchain = [Environment.DEV, Environment.LOC].includes(Config.environment)
    ? Blockchain.SEPOLIA
    : Blockchain.ETHEREUM;
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
    private readonly fiatService: FiatService,
    @Inject(forwardRef(() => BuyService))
    private readonly buyService: BuyService,
    @Inject(forwardRef(() => SellService))
    private readonly sellService: SellService,
    private readonly eip7702DelegationService: Eip7702DelegationService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly accountMergeService: AccountMergeService,
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
      blockchain: this.tokenBlockchain,
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

  async getBrokerbotInfo(): Promise<BrokerbotInfoDto> {
    return this.blockchainService.getBrokerbotInfo();
  }

  // --- Buy Payment Info Methods ---

  async getPaymentInfo(user: User, dto: RealUnitBuyDto): Promise<RealUnitPaymentInfoDto> {
    const userData = user.userData;
    const currencyName = dto.currency ?? 'CHF';

    // 1. Registration required
    if (!this.hasRegistrationForWallet(userData, user.address)) {
      throw new RegistrationRequiredException();
    }

    // 2. KYC Level check - Level 20 for amounts <= 1000 CHF, Level 50 for higher amounts
    const currency = await this.fiatService.getFiatByName(currencyName);
    const amountChf =
      currencyName === 'CHF'
        ? dto.amount
        : (await this.pricingService.getPrice(currency, PriceCurrency.CHF, PriceValidity.ANY)).convert(dto.amount);

    const maxAmountForLevel20 = Config.tradingLimits.monthlyDefaultWoKyc;
    const requiresLevel50 = amountChf > maxAmountForLevel20;
    const requiredLevel = requiresLevel50 ? KycLevel.LEVEL_50 : KycLevel.LEVEL_20;

    if (userData.kycLevel < requiredLevel) {
      throw new KycLevelRequiredException(
        requiredLevel,
        userData.kycLevel,
        requiresLevel50
          ? `KYC Level 50 required for amounts above ${maxAmountForLevel20} CHF`
          : 'KYC Level 20 required for RealUnit',
      );
    }

    // 3. Get or create Buy route for REALU
    const realuAsset = await this.getRealuAsset();
    const buy = await this.buyService.createBuy(user, user.address, { asset: realuAsset }, true);

    // 4. Call BuyService to get payment info (handles fees, rates, IBAN creation, QR codes, etc.)
    const buyPaymentInfo = await this.buyService.toPaymentInfoDto(user.id, buy, {
      amount: dto.amount,
      targetAmount: undefined,
      currency,
      asset: realuAsset,
      paymentMethod: FiatPaymentMethod.BANK,
      exactPrice: false,
    });

    // 5. Override recipient info with RealUnit company address
    const { bank: realunitBank, address: realunitAddress } = GetConfig().blockchain.realunit;
    const response: RealUnitPaymentInfoDto = {
      id: buyPaymentInfo.id,
      routeId: buyPaymentInfo.routeId,
      timestamp: buyPaymentInfo.timestamp,
      // Override recipient fields with RealUnit company address
      name: realunitBank.recipient,
      street: realunitAddress.street,
      number: realunitAddress.number,
      zip: realunitAddress.zip,
      city: realunitAddress.city,
      country: realunitAddress.country,
      // Bank info from BuyService
      iban: buyPaymentInfo.iban,
      bic: buyPaymentInfo.bic,
      // Amount and currency
      amount: buyPaymentInfo.amount,
      currency: buyPaymentInfo.currency.name,
      // Fee info
      fees: buyPaymentInfo.fees,
      minVolume: buyPaymentInfo.minVolume,
      maxVolume: buyPaymentInfo.maxVolume,
      minVolumeTarget: buyPaymentInfo.minVolumeTarget,
      maxVolumeTarget: buyPaymentInfo.maxVolumeTarget,
      // Rate info
      exchangeRate: buyPaymentInfo.exchangeRate,
      rate: buyPaymentInfo.rate,
      priceSteps: buyPaymentInfo.priceSteps,
      // RealUnit specific
      estimatedAmount: buyPaymentInfo.estimatedAmount,
      paymentRequest: buyPaymentInfo.paymentRequest,
      isValid: buyPaymentInfo.isValid,
      error: buyPaymentInfo.error,
    };

    return response;
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

    if (!userData.mail) {
      // Email not set yet - try to set it (will fail if email already exists for another user)
      await this.userDataService.trySetUserMail(userData, dto.email);
    } else if (!Util.equalsIgnoreCase(dto.email, userData.mail)) {
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

  async registerEmail(userDataId: number, dto: RealUnitEmailRegistrationDto): Promise<RealUnitEmailRegistrationStatus> {
    const userData = await this.userDataService.getUserData(userDataId, { users: true, kycSteps: true, wallet: true });
    if (!userData) throw new NotFoundException('User not found');

    if (userData.wallet?.name !== 'RealUnit') {
      throw new BadRequestException('Registration is only allowed from RealUnit wallet');
    }

    const isNewEmail = !userData.mail || !Util.equalsIgnoreCase(dto.email, userData.mail);

    if (isNewEmail) {
      if (userData.mail && this.hasRegistrationForWallet(userData, dto.walletAddress)) {
        throw new BadRequestException('Not allowed to register a new email for this address');
      }

      try {
        await this.userDataService.trySetUserMail(userData, dto.email);
      } catch (e) {
        if (e instanceof ConflictException) {
          if (e.message.includes('account merge request sent')) {
            return RealUnitEmailRegistrationStatus.MERGE_REQUESTED;
          }
        }
        throw e;
      }
    }

    if (userData.kycLevel < KycLevel.LEVEL_10) {
      await this.kycService.initializeProcess(userData);
    }

    return RealUnitEmailRegistrationStatus.EMAIL_REGISTERED;
  }

  async completeRegistration(userDataId: number, dto: RealUnitRegistrationDto): Promise<RealUnitRegistrationStatus> {
    await this.validateRegistrationDto(dto);

    // get and validate user
    const userData = await this.userService
      .getUserByAddress(dto.walletAddress, {
        userData: { kycSteps: true, users: true, country: true, organizationCountry: true },
      })
      .then((u) => u?.userData);

    if (!userData) throw new NotFoundException('User not found');
    if (userData.id !== userDataId) throw new BadRequestException('Wallet address does not belong to user');

    if (userData.kycLevel < KycLevel.LEVEL_10 || !userData.mail) {
      throw new BadRequestException('Email registration must be completed first');
    }
    if (!Util.equalsIgnoreCase(dto.email, userData.mail)) {
      throw new BadRequestException('Email does not match registered email');
    }

    if (this.hasRegistrationForWallet(userData, dto.walletAddress)) {
      throw new BadRequestException('RealUnit registration already exists for this wallet');
    }

    // validate personal data
    const hasExistingData = userData.firstname != null;
    if (hasExistingData && !this.isPersonalDataMatching(userData, dto)) {
      throw new BadRequestException('Personal data does not match existing data');
    }

    // save personal data
    if (!hasExistingData) {
      await this.userDataService.updatePersonalData(userData, dto.kycData);
      await this.userDataService.updateUserDataInternal(userData, {
        nationality: await this.countryService.getCountryWithSymbol(dto.nationality),
        birthday: new Date(dto.birthday),
        language: dto.lang && (await this.languageService.getLanguageBySymbol(dto.lang)),
        tin: dto.countryAndTINs?.length ? JSON.stringify(dto.countryAndTINs) : undefined,
      });
    }

    // store data with internal review
    const kycStep = await this.kycService.createCustomKycStep(
      userData,
      KycStepName.REALUNIT_REGISTRATION,
      ReviewStatus.INTERNAL_REVIEW,
      dto,
    );

    // forward to Aktionariat
    const success = await this.forwardRegistration(kycStep, dto);
    if (!success) return RealUnitRegistrationStatus.FORWARDING_FAILED;

    return RealUnitRegistrationStatus.COMPLETED;
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

    const message = {
      email: data.email,
      name: data.name,
      type: data.type,
      phoneNumber: data.phoneNumber,
      birthday: data.birthday,
      nationality: data.nationality,
      addressStreet: data.addressStreet,
      addressPostalCode: data.addressPostalCode,
      addressCity: data.addressCity,
      addressCountry: data.addressCountry,
      swissTaxResidence: data.swissTaxResidence,
      registrationDate: data.registrationDate,
      walletAddress: data.walletAddress,
    };

    const signatureToUse = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`;
    const recoveredAddress = verifyTypedData(domain, types, message, signatureToUse);

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

  private hasRegistrationForWallet(userData: UserData, walletAddress: string): boolean {
    return userData
      .getStepsWith(KycStepName.REALUNIT_REGISTRATION)
      .filter((s) => !(s.isFailed || s.isCanceled))
      .some((s) => {
        const result = s.getResult<AktionariatRegistrationDto>();
        return result?.walletAddress && Util.equalsIgnoreCase(result.walletAddress, walletAddress);
      });
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

      // Set KYC Level 20 if not already higher (same as NATIONALITY_DATA step)
      if (kycStep.userData.kycLevel < KycLevel.LEVEL_20) {
        await this.userDataService.updateUserDataInternal(kycStep.userData, { kycLevel: KycLevel.LEVEL_20 });
      }

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

  // --- Sell Payment Info Methods ---

  async getSellPaymentInfo(user: User, dto: RealUnitSellDto): Promise<RealUnitSellPaymentInfoDto> {
    const userData = user.userData;
    const currencyName = dto.currency ?? 'CHF';

    // 1. Registration required
    if (!this.hasRegistrationForWallet(userData, user.address)) {
      throw new RegistrationRequiredException();
    }

    // 2. KYC Level check - Level 20 minimum
    const requiredLevel = KycLevel.LEVEL_20;
    if (userData.kycLevel < requiredLevel) {
      throw new KycLevelRequiredException(requiredLevel, userData.kycLevel, 'KYC Level 20 required for RealUnit sell');
    }

    // 3. Get REALU asset
    const realuAsset = await this.getRealuAsset();
    if (!realuAsset) throw new NotFoundException('REALU asset not found');

    // 4. Get currency
    const currency = await this.fiatService.getFiatByName(currencyName);

    // 5. Get or create Sell route
    const sell = await this.sellService.createSell(
      user.id,
      { iban: dto.iban, currency, blockchain: realuAsset.blockchain },
      true,
    );

    // 6. Call SellService to get payment info (handles fees, rates, transaction request creation, etc.)
    const sellPaymentInfo = await this.sellService.toPaymentInfoDto(
      user.id,
      sell,
      {
        iban: dto.iban,
        asset: realuAsset,
        currency,
        amount: dto.amount,
        targetAmount: dto.targetAmount,
        exactPrice: false,
      },
      false, // includeTx
    );

    // 7. Prepare EIP-7702 delegation data (ALWAYS for RealUnit - app supports eth_sign)
    const delegationData = await this.eip7702DelegationService.prepareDelegationDataForRealUnit(
      user.address,
      realuAsset.blockchain,
    );

    // 8. Build response with EIP-7702 data AND fallback transfer info
    const amountWei = EvmUtil.toWeiAmount(sellPaymentInfo.amount, realuAsset.decimals);

    const response: RealUnitSellPaymentInfoDto = {
      // Identification
      id: sellPaymentInfo.id,
      routeId: sellPaymentInfo.routeId,
      timestamp: sellPaymentInfo.timestamp,

      // EIP-7702 Data (ALWAYS present for RealUnit)
      eip7702: {
        ...delegationData,
        tokenAddress: realuAsset.chainId,
        amountWei: amountWei.toString(),
        depositAddress: sellPaymentInfo.depositAddress,
      },

      // Fallback Transfer Info (ALWAYS present)
      depositAddress: sellPaymentInfo.depositAddress,
      amount: sellPaymentInfo.amount,
      tokenAddress: realuAsset.chainId,
      chainId: EvmUtil.getChainId(realuAsset.blockchain),

      // Fee Info
      fees: sellPaymentInfo.fees,
      minVolume: sellPaymentInfo.minVolume,
      maxVolume: sellPaymentInfo.maxVolume,
      minVolumeTarget: sellPaymentInfo.minVolumeTarget,
      maxVolumeTarget: sellPaymentInfo.maxVolumeTarget,

      // Rate Info
      exchangeRate: sellPaymentInfo.exchangeRate,
      rate: sellPaymentInfo.rate,
      priceSteps: sellPaymentInfo.priceSteps,

      // Result
      estimatedAmount: sellPaymentInfo.estimatedAmount,
      currency: sellPaymentInfo.currency.name,
      beneficiary: {
        name: sellPaymentInfo.beneficiary.name,
        iban: sellPaymentInfo.beneficiary.iban,
      },

      isValid: sellPaymentInfo.isValid,
      error: sellPaymentInfo.error,
    };

    return response;
  }

  async confirmSell(userId: number, requestId: number, dto: RealUnitSellConfirmDto): Promise<{ txHash: string }> {
    // 1. Get and validate TransactionRequest (getOrThrow validates ownership and existence)
    const request = await this.transactionRequestService.getOrThrow(requestId, userId);
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');

    // 2. Get the sell route and REALU asset
    const sell = await this.sellService.getById(request.routeId, { relations: { deposit: true, user: true } });
    if (!sell) throw new NotFoundException('Sell route not found');

    const realuAsset = await this.getRealuAsset();
    if (!realuAsset) throw new NotFoundException('REALU asset not found');

    let txHash: string;

    // 3. Execute transfer
    if (dto.eip7702) {
      // Validate delegator matches user address (defense-in-depth, contract also verifies signature)
      if (dto.eip7702.delegation.delegator.toLowerCase() !== request.user.address.toLowerCase()) {
        throw new BadRequestException('Delegation delegator does not match user address');
      }

      // Execute gasless transfer via EIP-7702 delegation (ForRealUnit bypasses global disable)
      txHash = await this.eip7702DelegationService.transferTokenWithUserDelegationForRealUnit(
        request.user.address,
        realuAsset,
        sell.deposit.address,
        request.amount,
        dto.eip7702.delegation,
        dto.eip7702.authorization,
      );

      this.logger.info(`RealUnit sell confirmed via EIP-7702: ${txHash}`);
    } else if (dto.txHash) {
      // User sent manually (format validated by DTO)
      txHash = dto.txHash;
      this.logger.info(`RealUnit sell confirmed with manual txHash: ${txHash}`);
    } else {
      throw new BadRequestException('Either eip7702 or txHash must be provided');
    }

    // 4. Mark request as complete
    await this.transactionRequestService.complete(request.id);

    return { txHash };
  }
}
