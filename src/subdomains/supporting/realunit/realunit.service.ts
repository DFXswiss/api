import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BigNumber, ethers } from 'ethers';
import { verifyTypedData } from 'ethers/lib/utils';
import { request } from 'graphql-request';
import { Config, Environment, GetConfig } from 'src/config/config';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import {
  BrokerbotBuyPriceDto,
  BrokerbotBuySharesDto,
  BrokerbotCurrency,
  BrokerbotInfoDto,
  BrokerbotPriceDto,
  BrokerbotSellPriceDto,
  BrokerbotSellSharesDto,
} from 'src/integration/blockchain/realunit/dto/realunit-broker.dto';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { HttpService } from 'src/shared/services/http.service';
import { AsyncCache, CacheItemResetPeriod } from 'src/shared/utils/async-cache';
import { toBitboxAscii } from 'src/shared/utils/bitbox-ascii.util';
import { PdfUtil } from 'src/shared/utils/pdf.util';
import { Util } from 'src/shared/utils/util';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { FaucetRequestService } from 'src/subdomains/core/faucet-request/services/faucet-request.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { KycStep } from 'src/subdomains/generic/kyc/entities/kyc-step.entity';
import { KycStepName } from 'src/subdomains/generic/kyc/enums/kyc-step-name.enum';
import { KycContext } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { PartnerConsentService } from 'src/subdomains/generic/partner-consent/partner-consent.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { TransactionRequestStatus } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { transliterate } from 'transliteration';
import { AssetPricesService } from '../pricing/services/asset-prices.service';
import { PriceCurrency, PriceValidity, PricingService } from '../pricing/services/pricing.service';
import {
  AccountHistoryClientResponse,
  AccountSummaryClientResponse,
  HistoryEventType,
  HoldersClientResponse,
  TokenInfoClientResponse,
} from './dto/client.dto';
import { RealUnitQuoteDto, RealUnitTransactionDto } from './dto/realunit-admin.dto';
import { RealUnitDisclaimerStatusDto } from './dto/realunit-disclaimer.dto';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import {
  AktionariatRegistrationDto,
  RealUnitEmailRegistrationDto,
  RealUnitEmailRegistrationStatus,
  RealUnitLanguage,
  RealUnitRegisterWalletDto,
  RealUnitRegistrationDto,
  RealUnitRegistrationInfoDto,
  RealUnitRegistrationState,
  RealUnitRegistrationStatus,
  RealUnitUserDataDto,
  RealUnitUserType,
} from './dto/realunit-registration.dto';
import {
  RealUnitSellBroadcastDto,
  RealUnitSellConfirmDto,
  RealUnitSellDto,
  RealUnitSellPaymentInfoDto,
} from './dto/realunit-sell.dto';
import {
  AccountHistoryDto,
  AccountSummaryDto,
  HistoricalPriceDto,
  HistoryEventDto,
  HoldersDto,
  RealUnitBuyDto,
  RealUnitPaymentInfoDto,
  TimeFrame,
  TokenInfoDto,
} from './dto/realunit.dto';
import { PriceInvalidException } from '../pricing/domain/exceptions/price-invalid.exception';
import { RealUnitDisclaimerTopic } from './enums/realunit-disclaimer-topic.enum';
import { KycLevelRequiredException, RegistrationRequiredException } from './exceptions/buy-exceptions';
import { PriceSourceUnavailableException } from './exceptions/price-source-unavailable.exception';
import { RealUnitDevService } from './realunit-dev.service';
import { getAccountHistoryQuery, getAccountSummaryQuery, getHoldersQuery, getTokenInfoQuery } from './utils/queries';
import { TimeseriesUtils } from './utils/timeseries-utils';

// realunit-app v0.0.3+ transliterates EIP-712 string fields to BitBox-safe
// ASCII (Krüger → Krueger) but keeps the kycData copy in UTF-8 so ID
// verification still sees the legal name with diacritics. Accept either
// representation so registrations from both old and new app versions pass.
function matchesSignedField(kycValue: string | undefined, signedValue: string | undefined): boolean {
  if (kycValue === signedValue) return true;
  if (kycValue == null || signedValue == null) return false;
  return toBitboxAscii(kycValue) === signedValue;
}

const REGISTRATION_EIP712_DOMAIN = { name: 'RealUnitUser', version: '1' };

const REGISTRATION_EIP712_TYPES = {
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

// The EIP-712 fields a registration signature is computed over, in the exact
// representation that was signed (raw UTF-8 or BitBox-safe ASCII).
type SignedRegistrationMessage = Pick<
  AktionariatRegistrationDto,
  | 'email'
  | 'name'
  | 'type'
  | 'phoneNumber'
  | 'birthday'
  | 'nationality'
  | 'addressStreet'
  | 'addressPostalCode'
  | 'addressCity'
  | 'addressCountry'
  | 'swissTaxResidence'
  | 'registrationDate'
  | 'walletAddress'
>;

@Injectable()
export class RealUnitService {
  private readonly logger = new DfxLogger(RealUnitService);

  private readonly ponderUrl: string;
  private readonly genesisDate = new Date('2022-04-12 07:46:41.000');
  private readonly tokenName = 'REALU';
  // Getter, not a field: Config is undefined until ConfigService is constructed, so reading it
  // in a field initializer can crash bootstrap depending on provider-instantiation order.
  private get tokenBlockchain(): Blockchain {
    return [Environment.DEV, Environment.LOC].includes(Config.environment) ? Blockchain.SEPOLIA : Blockchain.ETHEREUM;
  }
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
    private readonly ethereumService: EthereumService,
    private readonly sepoliaService: SepoliaService,
    private readonly transactionRequestService: TransactionRequestService,
    private readonly transactionService: TransactionService,
    private readonly accountMergeService: AccountMergeService,
    private readonly devService: RealUnitDevService,
    private readonly swissQrService: SwissQRService,
    private readonly feeService: FeeService,
    private readonly faucetRequestService: FaucetRequestService,
    private readonly partnerConsentService: PartnerConsentService,
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

  async getHistoryEventByTxHash(address: string, txHash: string): Promise<HistoryEventDto> {
    const normalizedTxHash = txHash.toLowerCase();
    let cursor: string | undefined;

    while (true) {
      const history = await this.getAccountHistory(address, 100, cursor);

      const event = history.history.find(
        (e) => e.txHash.toLowerCase() === normalizedTxHash && e.eventType === HistoryEventType.TRANSFER,
      );

      if (event) return event;

      if (!history.pageInfo.hasNextPage) break;
      cursor = history.pageInfo.endCursor;
    }

    throw new NotFoundException('Transaction not found in account history');
  }

  async getHistoryEventsByTxHashes(address: string, txHashes: string[]): Promise<HistoryEventDto[]> {
    const normalizedHashes = new Set(txHashes.map((h) => h.toLowerCase()));
    const foundEvents: HistoryEventDto[] = [];
    let cursor: string | undefined;

    while (foundEvents.length < txHashes.length) {
      const history = await this.getAccountHistory(address, 100, cursor);

      for (const event of history.history) {
        if (
          normalizedHashes.has(event.txHash.toLowerCase()) &&
          event.eventType === HistoryEventType.TRANSFER &&
          !foundEvents.some((e) => e.txHash.toLowerCase() === event.txHash.toLowerCase())
        ) {
          foundEvents.push(event);
        }
      }

      if (!history.pageInfo.hasNextPage) break;
      cursor = history.pageInfo.endCursor;
    }

    return foundEvents;
  }

  async getRealuAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: this.tokenName,
      blockchain: this.tokenBlockchain,
      type: AssetType.TOKEN,
    });
  }

  private async getZchfAsset(): Promise<Asset> {
    return this.assetService.getAssetByQuery({
      name: 'ZCHF',
      blockchain: this.tokenBlockchain,
      type: AssetType.TOKEN,
    });
  }

  private getBrokerbotAddress(): string {
    return GetConfig().blockchain.realunit.brokerbotAddress;
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
    const historicalPrices = await this.historicalPriceCache.get(timeFrame, async () => {
      const startDate = await this.getHistoricalPriceStartDate(timeFrame);
      const prices = await this.assetPricesService.getAssetPrices([await this.getRealuAsset()], startDate);
      const filledPrices = TimeseriesUtils.fillMissingDates(prices);
      return RealUnitDtoMapper.assetPricesToHistoricalPricesDto(filledPrices);
    });

    if (historicalPrices.length > 0) {
      const currentPrice = await this.getRealUnitPrice();
      historicalPrices[historicalPrices.length - 1] = {
        timestamp: currentPrice.timestamp,
        chf: currentPrice.chf,
        eur: currentPrice.eur,
        usd: currentPrice.usd,
      };
    }

    return historicalPrices;
  }

  async getRealUnitInfo(): Promise<TokenInfoDto> {
    const tokenInfoQuery = getTokenInfoQuery();
    const clientResponse = await request<TokenInfoClientResponse>(this.ponderUrl, tokenInfoQuery);
    return RealUnitDtoMapper.toTokenInfoDto(clientResponse);
  }

  // --- Brokerbot Methods ---

  async getBrokerbotPrice(currency?: BrokerbotCurrency): Promise<BrokerbotPriceDto> {
    return this.blockchainService.getBrokerbotPrice(currency);
  }

  async getBrokerbotBuyPrice(shares: number, currency?: BrokerbotCurrency): Promise<BrokerbotBuyPriceDto> {
    return this.blockchainService.getBrokerbotBuyPrice(shares, currency);
  }

  async getBrokerbotBuyShares(amount: number, currency?: BrokerbotCurrency): Promise<BrokerbotBuySharesDto> {
    return this.blockchainService.getBrokerbotBuyShares(amount, currency);
  }

  async getBrokerbotInfo(currency?: BrokerbotCurrency): Promise<BrokerbotInfoDto> {
    const [realuAsset, zchfAsset] = await Promise.all([this.getRealuAsset(), this.getZchfAsset()]);
    return this.blockchainService.getBrokerbotInfo(
      this.getBrokerbotAddress(),
      realuAsset.chainId,
      zchfAsset.chainId,
      currency,
    );
  }

  async getBrokerbotSellPrice(
    user: User,
    shares: number,
    currency?: BrokerbotCurrency,
  ): Promise<BrokerbotSellPriceDto> {
    const currencyName = currency ?? BrokerbotCurrency.CHF;
    const [realuAsset, fiat] = await Promise.all([this.getRealuAsset(), this.fiatService.getFiatByName(currencyName)]);

    const { pricePerShare } = await this.blockchainService.getBrokerbotPrice(currencyName);
    const grossAmount = pricePerShare * shares;

    const fee = await this.feeService.getUserFee({
      user,
      from: realuAsset,
      to: fiat,
      paymentMethodIn: CryptoPaymentMethod.CRYPTO,
      paymentMethodOut: FiatPaymentMethod.BANK,
      bankIn: undefined,
      specialCodes: [],
      allowCachedBlockchainFee: true,
    });

    const feeRate = fee.dfx.rate + fee.bank.rate + fee.partner.rate;
    const feeFixed = fee.dfx.fixed + fee.bank.fixed + fee.partner.fixed;

    const totalFee = grossAmount * feeRate + feeFixed + fee.network;
    const estimatedAmount = Math.max(grossAmount - totalFee, 0);
    const pricePerShareAfterFees = shares > 0 ? estimatedAmount / shares : 0;

    return {
      shares,
      pricePerShare: Util.round(pricePerShareAfterFees, 2),
      estimatedAmount: Util.round(estimatedAmount, 2),
      currency: currencyName,
    };
  }

  async getBrokerbotSellShares(
    user: User,
    targetAmount: number,
    currency?: BrokerbotCurrency,
  ): Promise<BrokerbotSellSharesDto> {
    const currencyName = currency ?? BrokerbotCurrency.CHF;
    const [realuAsset, fiat] = await Promise.all([this.getRealuAsset(), this.fiatService.getFiatByName(currencyName)]);

    const { pricePerShare } = await this.blockchainService.getBrokerbotPrice(currencyName);

    const fee = await this.feeService.getUserFee({
      user,
      from: realuAsset,
      to: fiat,
      paymentMethodIn: CryptoPaymentMethod.CRYPTO,
      paymentMethodOut: FiatPaymentMethod.BANK,
      bankIn: undefined,
      specialCodes: [],
      allowCachedBlockchainFee: true,
    });

    const feeRate = fee.dfx.rate + fee.bank.rate + fee.partner.rate;
    const feeFixed = fee.dfx.fixed + fee.bank.fixed + fee.partner.fixed;

    // Calculate shares needed: targetAmount = grossAmount - fees
    const divisor = 1 - feeRate;
    const grossAmountRaw = divisor > 0 ? (targetAmount + feeFixed + fee.network) / divisor : targetAmount;
    const shares = Math.max(1, Math.ceil(grossAmountRaw / pricePerShare));

    // Recalculate actual estimated amount with rounded shares
    const actualGrossAmount = shares * pricePerShare;
    const totalFee = actualGrossAmount * feeRate + feeFixed + fee.network;
    const estimatedAmount = actualGrossAmount - totalFee;
    const pricePerShareAfterFees = shares > 0 ? estimatedAmount / shares : 0;

    return {
      targetAmount,
      shares,
      pricePerShare: Util.round(pricePerShareAfterFees, 2),
      currency: currencyName,
    };
  }

  // --- Buy Payment Info Methods ---

  // Runs a quote computation that depends on the RealUnit price. If it fails and
  // the pricing service throws a PriceInvalidException (external source Aktionariat down),
  // surface that explicitly as 503 instead of leaking a generic 500.
  private async withPriceSourceGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof PriceInvalidException) throw new PriceSourceUnavailableException();
      throw e;
    }
  }

  async getPaymentInfo(user: User, dto: RealUnitBuyDto): Promise<RealUnitPaymentInfoDto> {
    const userData = user.userData;
    const currencyName = dto.currency ?? 'CHF';

    // 1. Registration required
    if (!this.hasRegistrationForWallet(userData, user.address)) {
      throw new RegistrationRequiredException(undefined, KycContext.REALUNIT_BUY);
    }

    // 2. KYC Level check - Level 30 required for all RealUnit purchases
    const currency = await this.fiatService.getFiatByName(currencyName);

    if (userData.kycLevel < KycLevel.LEVEL_30) {
      throw new KycLevelRequiredException(
        KycLevel.LEVEL_30,
        userData.kycLevel,
        'KYC Level 30 required for RealUnit',
        KycContext.REALUNIT_BUY,
      );
    }

    // 3. Get or create Buy route for REALU
    const realuAsset = await this.getRealuAsset();
    const buy = await this.buyService.createBuy(user, user.address, { asset: realuAsset }, true);

    // 4. Call BuyService to get payment info (handles fees, rates, IBAN creation, QR codes, etc.)
    const buyPaymentInfo = await this.withPriceSourceGuard(() =>
      this.buyService.toPaymentInfoDto(user.id, buy, {
        amount: dto.amount,
        targetAmount: undefined,
        currency,
        asset: realuAsset,
        paymentMethod: FiatPaymentMethod.BANK,
        exactPrice: false,
      }),
    );

    // 5. Override recipient info with RealUnit company address
    const { bank: realunitBank, address: realunitAddress } = GetConfig().blockchain.realunit;
    const iban = currencyName === 'EUR' ? realunitBank.ibanEur : realunitBank.iban;
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
      // Bank info from RealUnit config (not Yapeal/DFX)
      iban,
      bic: realunitBank.bic,
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
      paymentRequest: buyPaymentInfo.isValid
        ? this.generatePaymentRequest(
            currencyName,
            buyPaymentInfo.amount,
            buy.bankUsage,
            { ...realunitBank, iban },
            realunitAddress,
            user.userData,
          )
        : undefined,
      remittanceInfo: buy.active ? buy.bankUsage : undefined,
      isValid: buyPaymentInfo.isValid,
      error: buyPaymentInfo.error,
    };

    return response;
  }

  private generatePaymentRequest(
    currency: string,
    amount: number,
    reference: string,
    bank: { iban: string; bic: string; recipient: string; name: string },
    address: { street: string; number: string; zip: string; city: string; country: string },
    userData: UserData,
  ): string {
    const bankInfo = {
      name: bank.recipient,
      bank: bank.name,
      street: address.street,
      number: address.number,
      zip: address.zip,
      city: address.city,
      country: address.country,
      iban: bank.iban,
      bic: bank.bic,
      sepaInstant: false,
    };

    if (currency === 'CHF') {
      return this.swissQrService.createQrCode(amount, 'CHF', reference, bankInfo, userData);
    }

    return PdfUtil.generateGiroCode({
      ...bankInfo,
      currency,
      amount,
      reference,
    });
  }

  async confirmBuy(userId: number, requestId: number): Promise<{ reference: string }> {
    const request = await this.transactionRequestService.getOrThrow(requestId, userId);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if ([TransactionRequestStatus.COMPLETED, TransactionRequestStatus.WAITING_FOR_PAYMENT].includes(request.status))
      throw new ConflictException('Transaction request is already confirmed');
    if (Util.daysDiff(request.created) >= Config.txRequestWaitingExpiryDays)
      throw new BadRequestException('Transaction request is expired');

    // Aktionariat API aufrufen
    const fiat = await this.fiatService.getFiat(request.sourceId);

    let aktionariatResponse: { reference: string; [key: string]: any };
    try {
      aktionariatResponse = [Environment.DEV, Environment.LOC].includes(Config.environment)
        ? { reference: `DEV-${request.id}-${Date.now()}`, mock: true }
        : await this.blockchainService.requestPaymentInstructions({
            currency: fiat.name,
            address: request.user.address,
            shares: Math.floor(request.estimatedAmount),
            price: Math.round(request.amount * 100),
          });
    } catch (error) {
      const message = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error;
      this.logger.error(
        `Failed to request payment instructions from Aktionariat for request ${requestId} (currency: ${fiat.name}, shares: ${Math.floor(request.estimatedAmount)}, price: ${Math.round(request.amount * 100)}): ${message}`,
      );
      throw new ServiceUnavailableException(`Aktionariat API error: ${message}`);
    }

    // Status + Response speichern
    await this.transactionRequestService.confirmTransactionRequest(request, JSON.stringify(aktionariatResponse));

    return { reference: aktionariatResponse.reference };
  }

  // --- Registration Methods ---

  hasRegistrationForWallet(userData: UserData, walletAddress: string): boolean {
    return this.findRegistrationStep(userData, walletAddress).isForCurrentWallet;
  }

  async registerEmail(userDataId: number, dto: RealUnitEmailRegistrationDto): Promise<RealUnitEmailRegistrationStatus> {
    const userData = await this.userDataService.getActiveUserData(userDataId, { users: true });

    if (!userData.mail) {
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
    } else if (!Util.equalsIgnoreCase(dto.email, userData.mail)) {
      throw new BadRequestException('Email does not match verified email');
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

    const { step: existingStep, isForCurrentWallet } = this.findRegistrationStep(userData, dto.walletAddress);
    if (isForCurrentWallet) {
      return this.idempotentRegistrationResult(userData, existingStep!, dto.signature);
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

  // --- Wallet Methods ---

  getRegistrationInfo(userData: UserData, walletAddress: string): RealUnitRegistrationInfoDto {
    const { step, isForCurrentWallet } = this.findRegistrationStep(userData, walletAddress);

    // Dispatch to one of three states so the client can route to the right UX without inferring
    // it locally. Order matters: a registration step for the current wallet (ALREADY_REGISTERED)
    // wins over any other signal; a step for a different wallet drives the one-tap Add-Wallet
    // flow (ADD_WALLET); otherwise this wallet still needs a fresh registration (NEW_REGISTRATION).
    if (step) {
      const stepUserData = this.toUserDataDto(step);
      const state = isForCurrentWallet
        ? RealUnitRegistrationState.ALREADY_REGISTERED
        : RealUnitRegistrationState.ADD_WALLET;
      return {
        isRegistered: state === RealUnitRegistrationState.ALREADY_REGISTERED,
        state,
        userData: stepUserData,
      };
    }

    // No step exists: this wallet needs a fresh RealUnit registration. Pre-fill the form from
    // existing DFX KYC data when we have verified personal data (firstname/surname present);
    // otherwise return NEW_REGISTRATION without `userData` so the client renders an empty form and
    // collects every field manually. `completeRegistration` accepts and persists manually-entered
    // data for first-time users — email registration (KYC Level 10) is the only prerequisite — so
    // this branch must not dead-end onboarding by withholding the registration step.
    return {
      isRegistered: false,
      state: RealUnitRegistrationState.NEW_REGISTRATION,
      userData: this.toUserDataDtoFromUserData(userData),
    };
  }

  // --- DISCLAIMER CONSENT --- //

  async getDisclaimerStatus(userData: UserData): Promise<RealUnitDisclaimerStatusDto> {
    const partner = userData.wallet;
    if (!partner) throw new NotFoundException('Partner not found for user');

    const required = new Map<string, number>(Object.entries(this.disclaimerVersions));
    const missing = await this.partnerConsentService.getMissingTopics(userData, partner, required);

    // Return in canonical wizard order (enum declaration order), not query order.
    return { requiredSteps: Object.values(RealUnitDisclaimerTopic).filter((topic) => missing.includes(topic)) };
  }

  async confirmDisclaimer(userData: UserData, steps: RealUnitDisclaimerTopic[]): Promise<void> {
    const partner = userData.wallet;
    if (!partner) throw new NotFoundException('Partner not found for user');

    const versions = this.disclaimerVersions;
    const entries = steps.map((topic) => ({ topic, version: versions[topic] }));
    await this.partnerConsentService.confirm(userData, partner, entries);
  }

  private get disclaimerVersions(): Record<RealUnitDisclaimerTopic, number> {
    return GetConfig().blockchain.realunit.disclaimer.versions;
  }

  async completeRegistrationForWalletAddress(
    userDataId: number,
    dto: RealUnitRegisterWalletDto,
  ): Promise<RealUnitRegistrationStatus> {
    const userData = await this.userService
      .getUserByAddress(dto.walletAddress, {
        userData: { kycSteps: true, users: true, country: true },
      })
      .then((u) => u?.userData);

    if (!userData) throw new NotFoundException('User not found');
    if (userData.id !== userDataId) throw new BadRequestException('Wallet address does not belong to user');

    const { step: registrationStep, isForCurrentWallet } = this.findRegistrationStep(userData, dto.walletAddress);

    if (isForCurrentWallet) {
      return this.idempotentRegistrationResult(userData, registrationStep!, dto.signature);
    }

    if (!registrationStep) {
      throw new BadRequestException('No RealUnit registration found');
    }

    const registrationData = registrationStep.getResult<RealUnitRegistrationDto>();
    if (!registrationData) {
      throw new BadRequestException('Invalid registration data');
    }

    // full registration DTO with new signature/wallet/date
    const { signature: _sig, walletAddress: _wallet, registrationDate: _date, ...accountData } = registrationData;
    const fullDto: RealUnitRegistrationDto = {
      ...accountData,
      walletAddress: dto.walletAddress,
      signature: dto.signature,
      registrationDate: dto.registrationDate,
    };

    if (!this.verifyRealUnitRegistrationSignature(fullDto)) {
      throw new BadRequestException('Invalid signature');
    }

    const kycStep = await this.kycService.createCustomKycStep(
      userData,
      KycStepName.REALUNIT_REGISTRATION,
      ReviewStatus.INTERNAL_REVIEW,
      fullDto,
    );

    const success = await this.forwardRegistration(kycStep, fullDto);

    return success ? RealUnitRegistrationStatus.COMPLETED : RealUnitRegistrationStatus.FORWARDING_FAILED;
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
      if (!matchesSignedField(dto.kycData.organizationName, dto.name)) {
        throw new BadRequestException('organizationName must match signed name');
      }

      // organization address
      const combinedOrgAddress = dto.kycData.organizationAddress.houseNumber
        ? `${dto.kycData.organizationAddress.street} ${dto.kycData.organizationAddress.houseNumber}`
        : dto.kycData.organizationAddress.street;
      if (!matchesSignedField(combinedOrgAddress, dto.addressStreet)) {
        throw new BadRequestException('organizationAddress street + houseNumber must match signed addressStreet');
      }

      if (!matchesSignedField(dto.kycData.organizationAddress.zip, dto.addressPostalCode)) {
        throw new BadRequestException('organizationAddress zip must match signed addressPostalCode');
      }

      if (!matchesSignedField(dto.kycData.organizationAddress.city, dto.addressCity)) {
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
      if (!matchesSignedField(combinedName, dto.name)) {
        throw new BadRequestException('firstName + lastName does not match signed name');
      }

      // personal address
      const combinedAddress = dto.kycData.address.houseNumber
        ? `${dto.kycData.address.street} ${dto.kycData.address.houseNumber}`
        : dto.kycData.address.street;
      if (!matchesSignedField(combinedAddress, dto.addressStreet)) {
        throw new BadRequestException('street + houseNumber does not match signed addressStreet');
      }
    }
  }

  private verifyRealUnitRegistrationSignature(data: RealUnitRegistrationDto): boolean {
    return this.resolveSignedRegistrationMessage(data) != null;
  }

  // Builds the EIP-712 message in either the raw or the BitBox-safe ASCII
  // representation. Only the free-text fields carry diacritics, so only those
  // are transliterated — mirrors realunit-app's signing path (Krüger → Krueger).
  private buildRegistrationMessage(data: RealUnitRegistrationDto, transliterate: boolean): SignedRegistrationMessage {
    const ascii = (value: string): string => (transliterate ? toBitboxAscii(value) : value);

    return {
      email: ascii(data.email),
      name: ascii(data.name),
      type: data.type,
      phoneNumber: ascii(data.phoneNumber),
      birthday: ascii(data.birthday),
      nationality: data.nationality,
      addressStreet: ascii(data.addressStreet),
      addressPostalCode: ascii(data.addressPostalCode),
      addressCity: ascii(data.addressCity),
      addressCountry: data.addressCountry,
      swissTaxResidence: data.swissTaxResidence,
      registrationDate: data.registrationDate,
      walletAddress: data.walletAddress,
    };
  }

  // Returns the EIP-712 fields exactly as the wallet signed them — raw UTF-8
  // (legacy software wallets, kept working by #3709) or BitBox-safe ASCII
  // (current app / any BitBox, whose firmware rejects non-ASCII bytes). Returns
  // undefined if the signature matches neither. Aktionariat re-verifies the
  // signature against the payload we POST in forwardRegistration, so the
  // forwarded bytes must be exactly these — forwarding any other variant fails
  // as "Invalid signature".
  private resolveSignedRegistrationMessage(data: RealUnitRegistrationDto): SignedRegistrationMessage | undefined {
    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`;

    for (const transliterate of [false, true]) {
      const message = this.buildRegistrationMessage(data, transliterate);
      const recovered = verifyTypedData(REGISTRATION_EIP712_DOMAIN, REGISTRATION_EIP712_TYPES, message, signature);
      if (Util.equalsIgnoreCase(recovered, data.walletAddress)) return message;
    }

    return undefined;
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

  /**
   * Finds a registration step for the user.
   * First tries to find a registration for the current wallet.
   * If not found, falls back to finding a registration from another wallet (for account merge scenarios).
   */
  private findRegistrationStep(
    userData: UserData,
    walletAddress: string,
  ): { step: KycStep | undefined; isForCurrentWallet: boolean } {
    const allSteps = userData.getStepsWith(KycStepName.REALUNIT_REGISTRATION);

    // First: look for registration for the current wallet (non-failed, non-canceled)
    const currentWalletStep = allSteps
      .filter((s) => !(s.isFailed || s.isCanceled))
      .find((s) => {
        const result = s.getResult<AktionariatRegistrationDto>();
        return result?.walletAddress && Util.equalsIgnoreCase(result.walletAddress, walletAddress);
      });

    if (currentWalletStep) {
      return { step: currentWalletStep, isForCurrentWallet: true };
    }

    // Second: look for registration from another wallet (for account merge)
    const otherWalletStep = allSteps
      .filter((s) => (s.isCompleted || s.isCanceled) && s.result)
      .find((s) => {
        const result = s.getResult<AktionariatRegistrationDto>();
        return result?.walletAddress && !Util.equalsIgnoreCase(result.walletAddress, walletAddress);
      });

    return { step: otherWalletStep, isForCurrentWallet: false };
  }

  /**
   * Idempotent fallback for repeated register/wallet calls (e.g. client retry after a lost
   * response). Same wallet + same EIP-712 signature → return the existing registration's
   * status without creating a new KycStep or re-forwarding. Different signature for the same
   * wallet stays a hard error: it means a fresh sign was produced over conflicting data.
   */
  private idempotentRegistrationResult(
    userData: UserData,
    step: KycStep,
    incomingSignature: string,
  ): RealUnitRegistrationStatus {
    const existingData = step.getResult<RealUnitRegistrationDto>();
    if (!Util.equalsIgnoreCase(existingData?.signature, incomingSignature)) {
      throw new BadRequestException('RealUnit registration already exists for this wallet with a different signature');
    }

    // Under the normal REALUNIT_REGISTRATION flow the step is in INTERNAL_REVIEW (created,
    // forward not run yet), MANUAL_REVIEW (forward failed, awaiting admin retry), or COMPLETED
    // (forward succeeded). findRegistrationStep filters out FAILED and CANCELED, but admin
    // overrides via kyc-admin.updateKycStep can leave other non-failed/non-canceled statuses
    // (e.g. ON_HOLD, OUTDATED) reachable here. Only COMPLETED is a terminal success; every
    // other reachable status falls through to FORWARDING_FAILED, which surfaces the same retry
    // path the client would have seen on the original call.
    // Surface ALREADY_REGISTERED (not COMPLETED) on the idempotent path so
    // clients can distinguish "registration just completed in this call"
    // from "registration was already in place". The wallet-app uses this
    // to skip the post-registration onboarding screens on retry.
    const status = step.isCompleted
      ? RealUnitRegistrationStatus.ALREADY_REGISTERED
      : RealUnitRegistrationStatus.FORWARDING_FAILED;

    this.logger.info(
      `RealUnit registration idempotent retry for userData ${userData.id}, kycStep ${step.id} → ${status}`,
    );

    return status;
  }

  private toUserDataDto(step: KycStep | undefined): RealUnitUserDataDto | undefined {
    if (!step) return undefined;

    const registrationData = step.getResult<RealUnitRegistrationDto>();
    if (!registrationData) return undefined;

    const { signature: _sig, walletAddress: _wallet, registrationDate: _date, ...userDataDto } = registrationData;

    return userDataDto as RealUnitUserDataDto;
  }

  // Pre-fill source for first-time RealUnit registrations: maps the user's existing DFX KYC data into
  // the Aktionariat-shaped DTO. The corresponding `completeRegistration` validation
  // (`isPersonalDataMatching`) compares the submitted KycPersonalData/address against the same
  // user_data fields, so the values returned here are guaranteed to pass that check.
  private toUserDataDtoFromUserData(userData: UserData): RealUnitUserDataDto | undefined {
    // Without verified personal data there is nothing useful to pre-fill — the app will continue to
    // collect every field manually.
    if (!userData.firstname && !userData.surname) return undefined;

    const lang = Object.values(RealUnitLanguage).find((l) => l === userData.language?.symbol?.toUpperCase());
    const addressStreet = [userData.street, userData.houseNumber].filter((s) => s).join(' ');
    const tinEntries: { country: string; tin: string }[] = userData.tin ? JSON.parse(userData.tin) : [];

    return {
      email: userData.mail ?? '',
      name: userData.naturalPersonName ?? '',
      type: RealUnitUserType.HUMAN,
      phoneNumber: userData.phone ?? '',
      birthday: userData.birthday ? Util.isoDate(userData.birthday) : '',
      nationality: userData.nationality?.symbol ?? '',
      addressStreet,
      addressPostalCode: userData.zip ?? '',
      addressCity: userData.location ?? '',
      addressCountry: userData.country?.symbol ?? '',
      // Swiss tax residence cannot be derived from KYC data alone; default to the country-of-residence
      // signal so a CH-resident pre-fills the common case. The user can still override before signing.
      swissTaxResidence: userData.country?.symbol === 'CH',
      lang: lang ?? RealUnitLanguage.EN,
      countryAndTINs: tinEntries.length ? tinEntries : undefined,
      kycData: {
        accountType: userData.accountType ?? AccountType.PERSONAL,
        firstName: userData.firstname ?? '',
        lastName: userData.surname ?? '',
        phone: userData.phone ?? '',
        address: {
          street: userData.street ?? '',
          houseNumber: userData.houseNumber,
          city: userData.location ?? '',
          zip: userData.zip ?? '',
          country: userData.country!,
        },
        organizationName: userData.organizationName ?? undefined,
        organizationAddress: userData.organizationCountry
          ? {
              street: userData.organizationStreet ?? '',
              houseNumber: userData.organizationHouseNumber,
              city: userData.organizationLocation ?? '',
              zip: userData.organizationZip ?? '',
              country: userData.organizationCountry,
            }
          : undefined,
      },
    };
  }

  private isPersonalDataMatching(userData: UserData, dto: RealUnitRegistrationDto): boolean {
    const kycData = dto.kycData;
    // Transliterate both sides: legacy rows still hold ASCII (pre-fix), new rows hold UTF-8.
    const asciiEq = (a?: string, b?: string): boolean => transliterate(a ?? '') === transliterate(b ?? '');

    if (!asciiEq(kycData.firstName, userData.firstname)) return false;
    if (!asciiEq(kycData.lastName, userData.surname)) return false;
    if (kycData.phone !== userData.phone) return false;
    if (kycData.accountType !== userData.accountType) return false;

    if (!asciiEq(kycData.address.street, userData.street)) return false;
    if (!asciiEq(kycData.address.houseNumber, userData.houseNumber)) return false;
    if (!asciiEq(kycData.address.city, userData.location)) return false;
    if (!asciiEq(kycData.address.zip, userData.zip)) return false;
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
      // forward only Aktionariat fields (exclude kycData to avoid signature verification issues).
      // Aktionariat re-verifies the EIP-712 signature against this payload, so send back the exact
      // representation that was signed — raw UTF-8 (legacy software wallets) or BitBox-safe ASCII
      // (current app / BitBox). Forwarding the wrong variant fails as "Invalid signature". The
      // UTF-8 originals stay on user_data for PDF/mail.
      const signedMessage = this.resolveSignedRegistrationMessage(dto) ?? this.buildRegistrationMessage(dto, false);
      const payload: AktionariatRegistrationDto = {
        ...signedMessage,
        signature: dto.signature,
        lang: dto.lang,
        countryAndTINs: dto.countryAndTINs,
      };

      if (![Environment.DEV, Environment.LOC].includes(Config.environment)) {
        await this.http.post(`${api.url}/registerUser`, payload, {
          headers: { 'x-api-key': api.key },
        });
      }

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
      throw new RegistrationRequiredException(undefined, KycContext.REALUNIT_SELL);
    }

    // 2. KYC Level check - Level 30 minimum
    if (userData.kycLevel < KycLevel.LEVEL_30) {
      throw new KycLevelRequiredException(
        KycLevel.LEVEL_30,
        userData.kycLevel,
        'KYC Level 30 required for RealUnit sell',
        KycContext.REALUNIT_SELL,
      );
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
    const sellPaymentInfo = await this.withPriceSourceGuard(() =>
      this.sellService.toPaymentInfoDto(
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
      ),
    );

    // 7. Check if limit exceeded
    if (sellPaymentInfo.error === QuoteError.LIMIT_EXCEEDED) {
      throw new KycLevelRequiredException(
        KycLevel.LEVEL_50,
        userData.kycLevel,
        'KYC Level 50 required for RealUnit sell exceeding trading limit',
        KycContext.REALUNIT_SELL,
      );
    }

    // 8. Prepare EIP-7702 delegation data, fetch gas info, and get accurate brokerbot ZCHF in parallel
    const evmClient = this.getEvmClient();
    const shares = Math.floor(sellPaymentInfo.amount);
    const [delegationData, zchfAsset, ethBalance, gasPrice, brokerbotResult] = await Promise.all([
      this.eip7702DelegationService.prepareDelegationDataForRealUnit(user.address, realuAsset.blockchain),
      this.getZchfAsset(),
      evmClient.getNativeCoinBalanceForAddress(user.address),
      evmClient.getRecommendedGasPrice(),
      shares > 0
        ? this.blockchainService.getBrokerbotSellPrice(this.getBrokerbotAddress(), shares).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Override estimatedAmount with on-chain brokerbot price so quote matches what the swap will actually pay
    let estimatedAmount = sellPaymentInfo.estimatedAmount;
    if (brokerbotResult && sellPaymentInfo.id) {
      estimatedAmount = EvmUtil.fromWeiAmount(
        ethers.BigNumber.from(brokerbotResult.zchfAmountWei.toString()),
        zchfAsset.decimals,
      );
      await this.transactionRequestService.updateEstimatedAmount(sellPaymentInfo.id, estimatedAmount);
    }

    // 350k for brokerbotSell + 100k conservative estimate for zchfDeposit (standard ERC20 transfer)
    const totalGasLimit = ethers.BigNumber.from(450_000);
    const requiredGasEth = EvmUtil.fromWeiAmount(gasPrice.mul(totalGasLimit));

    // 9. Build response with EIP-7702 data AND fallback transfer info
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
      chainId: realuAsset.evmChainId,

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
      estimatedAmount,
      currency: sellPaymentInfo.currency.name,
      beneficiary: {
        name: sellPaymentInfo.beneficiary.name,
        iban: sellPaymentInfo.beneficiary.iban,
      },

      ethBalance,
      requiredGasEth,

      isValid: sellPaymentInfo.isValid,
      error: sellPaymentInfo.error,
    };

    return response;
  }

  // --- Sell Transaction Methods for BitBox ---

  async createSellUnsignedTransactions(userId: number, requestId: number): Promise<{ swap: string; deposit: string }> {
    const request = await this.transactionRequestService.getOrThrow(requestId, userId);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');

    const client = this.getEvmClient();
    const realuAsset = await this.getRealuAsset();
    if (!realuAsset.chainId) throw new BadRequestException('REALU asset has no contract address');

    const [sell, zchfAsset, nonce, gasPrice] = await Promise.all([
      this.sellService.getById(request.routeId, { relations: { deposit: true } }),
      this.getZchfAsset(),
      client.getTransactionCount(request.user.address),
      client.getRecommendedGasPrice(),
    ]);
    if (!sell) throw new NotFoundException('Sell route not found');

    const swapGasLimit = ethers.BigNumber.from(350_000);
    const depositGasLimit = ethers.BigNumber.from(100_000);

    const ethBalance = await client.getNativeCoinBalanceForAddress(request.user.address);
    const requiredEth = EvmUtil.fromWeiAmount(gasPrice.mul(swapGasLimit.add(depositGasLimit)));
    if (ethBalance < requiredEth) {
      throw new BadRequestException(
        `Insufficient ETH for gas: need ${requiredEth.toFixed(6)} ETH, have ${ethBalance.toFixed(6)} ETH`,
      );
    }

    // Swap tx: nonce N — REALU transferAndCall to brokerbot
    const ERC677_INTERFACE = new ethers.utils.Interface([
      'function transferAndCall(address to, uint256 value, bytes data) returns (bool)',
    ]);
    const shares = Math.floor(request.amount);
    const swapAmountWei = ethers.utils.parseUnits(shares.toString(), realuAsset.decimals ?? 18);
    const swapData = ERC677_INTERFACE.encodeFunctionData('transferAndCall', [
      this.getBrokerbotAddress(),
      swapAmountWei,
      '0x',
    ]);

    const swap = ethers.utils.serializeTransaction({
      type: 2,
      chainId: client.chainId,
      nonce,
      maxPriorityFeePerGas: gasPrice,
      maxFeePerGas: gasPrice,
      gasLimit: swapGasLimit,
      to: realuAsset.chainId,
      value: ethers.BigNumber.from(0),
      data: swapData,
      accessList: [],
    });

    // Deposit tx: nonce N+1 — ZCHF ERC20 transfer to deposit address
    // Query the brokerbot for the exact ZCHF amount at current price so deposit matches swap output
    const { zchfAmountWei: depositAmountWei } = await this.blockchainService.getBrokerbotSellPrice(
      this.getBrokerbotAddress(),
      shares,
    );
    const depositData = EvmUtil.encodeErc20Transfer(sell.deposit.address, BigNumber.from(depositAmountWei.toString()));

    const deposit = ethers.utils.serializeTransaction({
      type: 2,
      chainId: client.chainId,
      nonce: nonce + 1,
      maxPriorityFeePerGas: gasPrice,
      maxFeePerGas: gasPrice,
      gasLimit: depositGasLimit,
      to: zchfAsset.chainId,
      value: ethers.BigNumber.from(0),
      data: depositData,
      accessList: [],
    });

    return { swap, deposit };
  }

  async broadcastSellTransaction(
    userId: number,
    requestId: number,
    dto: RealUnitSellBroadcastDto,
  ): Promise<{ txHash: string }> {
    const request = await this.transactionRequestService.getOrThrow(requestId, userId);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');

    const { unsignedTx, r, s, v } = dto;
    const parsed = ethers.utils.parseTransaction(unsignedTx);
    const signedHex = ethers.utils.serializeTransaction(
      {
        type: 2,
        chainId: parsed.chainId,
        nonce: parsed.nonce,
        maxPriorityFeePerGas: parsed.maxPriorityFeePerGas ?? ethers.BigNumber.from(0),
        maxFeePerGas: parsed.maxFeePerGas ?? ethers.BigNumber.from(0),
        gasLimit: parsed.gasLimit,
        to: parsed.to,
        value: parsed.value,
        data: parsed.data,
        accessList: parsed.accessList ?? [],
      },
      { r, s, v },
    );

    const client = this.getEvmClient();
    const result = await client.sendSignedTransaction(signedHex);

    if (result.error) throw new BadRequestException(`Broadcast failed: ${result.error.message}`);

    const txHash = result.response?.hash;
    if (!txHash) throw new BadRequestException('Broadcast returned no transaction hash');

    await this.faucetRequestService.resetFaucet(userId);

    return { txHash };
  }

  private getEvmClient(): EvmClient {
    return [Environment.DEV, Environment.LOC].includes(Config.environment)
      ? this.sepoliaService.getDefaultClient()
      : this.ethereumService.getDefaultClient();
  }

  // --- Admin Methods ---

  async confirmPaymentReceived(requestId: number): Promise<void> {
    const request = await this.transactionRequestService.getTransactionRequest(requestId, { user: true });
    if (!request) throw new NotFoundException('Transaction request not found');
    if (request.status !== TransactionRequestStatus.WAITING_FOR_PAYMENT) {
      throw new BadRequestException('Transaction request is not in WaitingForPayment status');
    }

    if ([Environment.DEV, Environment.LOC].includes(Config.environment)) {
      const realuAsset = await this.getRealuAsset();
      await this.devService.simulatePaymentForRequest(request, realuAsset);
    } else {
      const aktionariatResponse = JSON.parse(request.aktionariatResponse);
      const reference = aktionariatResponse.reference;
      if (!reference) throw new BadRequestException('No reference found in aktionariat response');

      // Convert amount to CHF Rappen for Aktionariat API
      const fiat = await this.fiatService.getFiat(request.sourceId);
      let amountChf = request.amount;
      if (fiat.name !== 'CHF') {
        const price = await this.pricingService.getPrice(fiat, PriceCurrency.CHF, PriceValidity.ANY);
        amountChf = price.convert(request.amount);
      }

      await this.blockchainService.payAndAllocate({
        amount: Math.round(amountChf * 100),
        ref: reference,
      });
      await this.transactionRequestService.complete(request.id);
    }
  }

  async getAdminQuotes(limit = 50, offset = 0): Promise<RealUnitQuoteDto[]> {
    const realuAsset = await this.getRealuAsset();
    const requests = await this.transactionRequestService.getByAssetId(realuAsset.id, limit, offset);

    return requests.map((r) => ({
      id: r.id,
      uid: r.uid,
      type: r.type,
      status: r.status,
      amount: r.amount,
      estimatedAmount: r.estimatedAmount,
      created: r.created,
      userAddress: r.user?.address,
    }));
  }

  async getAdminTransactions(limit = 50, offset = 0): Promise<RealUnitTransactionDto[]> {
    const realuAsset = await this.getRealuAsset();
    const transactions = await this.transactionService.getByAssetId(realuAsset.id, limit, offset);

    return transactions.map((t) => ({
      id: t.id,
      uid: t.uid,
      type: t.type,
      amountInChf: t.amountInChf,
      assets: t.assets,
      created: t.created,
      outputDate: t.outputDate,
      userAddress: t.user?.address,
    }));
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

      // Calculate expected ZCHF amount from BrokerBot
      // If price drops between quote and execution, transaction reverts safely and user can retry
      const [{ zchfAmountWei }, zchfAsset] = await Promise.all([
        this.blockchainService.getBrokerbotSellPrice(this.getBrokerbotAddress(), Math.floor(request.amount)),
        this.getZchfAsset(),
      ]);

      // Atomic batch: REALU -> BrokerBot -> ZCHF -> DFX Deposit
      txHash = await this.eip7702DelegationService.executeBrokerBotSellForRealUnit(
        request.user.address,
        realuAsset,
        zchfAsset.chainId,
        this.getBrokerbotAddress(),
        sell.deposit.address,
        Math.floor(request.amount),
        zchfAmountWei,
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
