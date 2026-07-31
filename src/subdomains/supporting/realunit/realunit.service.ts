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
import {
  Eip7702DelegationService,
  TransactionRevertedException,
} from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
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
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { FaucetRequestService } from 'src/subdomains/core/faucet-request/services/faucet-request.service';
import { PaymentLinkEvmHexBlockchains } from 'src/subdomains/core/payment-link/enums';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { KycContext } from 'src/subdomains/generic/kyc/enums/kyc.enum';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel, ServiceProvider } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import {
  TransactionRequest,
  TransactionRequestStatus,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { CreateSupportIssueDto } from 'src/subdomains/supporting/support-issue/dto/create-support-issue.dto';
import { CustomerAuthor } from 'src/subdomains/supporting/support-issue/entities/support-message.entity';
import { Department } from 'src/subdomains/supporting/support-issue/enums/department.enum';
import { SupportIssueReason, SupportIssueType } from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { transliterate } from 'transliteration';
import { EntityManager, FindOptionsRelations, In, IsNull, LessThan, Not, Raw } from 'typeorm';
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
import {
  RealUnitAktionariatConfirmationStatus,
  RealUnitConfirmAktionariatDto,
  RealUnitConfirmAktionariatQueryDto,
} from './dto/realunit-confirm-aktionariat.dto';
import { RealUnitDtoMapper } from './dto/realunit-dto.mapper';
import {
  RealUnitOcpPayResultDto,
  RealUnitOcpPayStatusDto,
  RealUnitOcpPaySubmitDto,
  RealUnitOcpPayUnsignedTransactionDto,
  RealUnitSwapDto,
  RealUnitSwapPaymentInfoDto,
} from './dto/realunit-pay.dto';
import {
  AktionariatRegistrationDto,
  MAX_SERIALIZED_TIN_LENGTH,
  MAX_TAX_RESIDENCES,
  MAX_TIN_LENGTH,
  RealUnitEmailRegistrationDto,
  RealUnitEmailRegistrationStatus,
  RealUnitLanguage,
  RealUnitRegisterWalletDto,
  RealUnitRegistrationDateDto,
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
  RealUnitTransferConfirmDto,
  RealUnitTransferDto,
  RealUnitTransferPaymentInfoDto,
} from './dto/realunit-transfer.dto';
import { RealUnitTransferRequestStatus } from './entities/realunit-transfer-request.entity';
import { RealUnitTransferRequestRepository } from './repositories/realunit-transfer-request.repository';
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
import {
  AmountTooLowException,
  KycLevelRequiredException,
  PrimaryEmailRequiredException,
  RegistrationRequiredException,
} from './exceptions/buy-exceptions';
import { AktionariatRegistration } from './entities/aktionariat-registration.entity';
import { PriceSourceUnavailableException } from './exceptions/price-source-unavailable.exception';
import { RealUnitDevService } from './realunit-dev.service';
import { AktionariatRegistrationRepository } from './repositories/aktionariat-registration.repository';
import { accountHistoryQuery, accountSummaryQuery, holdersQuery, tokenInfoQuery } from './utils/queries';
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

type RegistrationEip712Domain = typeof REGISTRATION_EIP712_DOMAIN & { chainId?: number };

enum RegistrationFieldEncoding {
  UTF8 = 'utf8',
  BITBOX_ASCII = 'bitboxAscii',
}

interface RegistrationSignatureVariant {
  domain: RegistrationEip712Domain;
  encoding: RegistrationFieldEncoding;
}

// The fields exactly as they were signed, plus the variant they recovered under.
interface ResolvedRegistrationSignature {
  message: SignedRegistrationMessage;
  variant: RegistrationSignatureVariant;
}

function describeVariant({ domain, encoding }: RegistrationSignatureVariant): string {
  const domainName = domain.chainId ? `chainId ${domain.chainId} domain` : 'legacy domain';
  const fields = encoding === RegistrationFieldEncoding.BITBOX_ASCII ? 'BitBox ASCII fields' : 'UTF-8 fields';

  return `${domainName} / ${fields}`;
}

@Injectable()
export class RealUnitService {
  private readonly logger = new DfxLogger(RealUnitService);

  private readonly ponderUrl: string;
  private readonly genesisDate = new Date('2022-04-12 07:46:41.000');
  private readonly tokenName = 'REALU';
  // Lower-cased prefix of Aktionariat's registerUser response that marks a matched existing shareholder
  // (full message: "Existing user found, updated your address."). Matched as a start-anchored prefix, not a
  // free substring: the alternative "Confirmation email sent to <email>" reply echoes the raw registrant
  // email, so a substring test would let an address embedding these words (e.g. a quoted local part) spoof
  // the marker and wrongly un-gate a registration whose confirmation email WAS sent and never confirmed.
  private static readonly existingShareholderMarker = 'existing user found';
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
    @Inject(forwardRef(() => SwapService))
    private readonly swapService: SwapService,
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
    private readonly aktionariatRegistrationRepo: AktionariatRegistrationRepository,
    private readonly logService: LogService,
    private readonly supportIssueService: SupportIssueService,
    private readonly transferRequestRepo: RealUnitTransferRequestRepository,
    private readonly lnUrlForwardService: LnUrlForwardService,
    private readonly paymentLinkPaymentService: PaymentLinkPaymentService,
  ) {
    this.ponderUrl = GetConfig().blockchain.realunit.graphUrl;
  }

  async getAccount(address: string): Promise<AccountSummaryDto> {
    const clientResponse = await request<AccountSummaryClientResponse>(this.ponderUrl, accountSummaryQuery, {
      id: address.toLowerCase(),
    });
    if (!clientResponse.account) throw new NotFoundException('Account not found');

    const historicalPrices = await this.getHistoricalPrice(TimeFrame.ALL);

    return RealUnitDtoMapper.toAccountSummaryDto(clientResponse, historicalPrices);
  }

  async getHolders(first?: number, before?: string, after?: string): Promise<HoldersDto> {
    const clientResponse = await request<HoldersClientResponse>(this.ponderUrl, holdersQuery, {
      limit: first || 50,
      before: before ?? null,
      after: after ?? null,
    });
    return RealUnitDtoMapper.toHoldersDto(clientResponse);
  }

  async getAccountHistory(
    address: string,
    first?: number,
    before?: string,
    after?: string,
  ): Promise<AccountHistoryDto> {
    const clientResponse = await request<AccountHistoryClientResponse>(this.ponderUrl, accountHistoryQuery, {
      id: address.toLowerCase(),
      limit: first || 50,
      before: before ?? null,
      after: after ?? null,
    });
    if (!clientResponse.account) throw new NotFoundException('Account not found');

    return RealUnitDtoMapper.toAccountHistoryDto(clientResponse);
  }

  async getHistoryEventByTxHash(address: string, txHash: string): Promise<HistoryEventDto> {
    const normalizedTxHash = txHash.toLowerCase();
    let cursor: string | undefined;

    while (true) {
      const history = await this.getAccountHistory(address, 100, undefined, cursor);

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
      const history = await this.getAccountHistory(address, 100, undefined, cursor);

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
    const { registration, isForCurrentWallet } = await this.findRegistration(userData, user.address);
    if (!isForCurrentWallet || !registration) {
      throw new RegistrationRequiredException(undefined, KycContext.REALUNIT_BUY);
    }
    const { emailConfirmed } = this.resolveEmailConfirmation(registration);

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

    // 5. Primary-email and confirmation pre-tap gate: Aktionariat rejects the buy confirm when the user has
    // no primary email or the registration email is still unconfirmed. Surface both here as pre-tap signals
    // (isValid/error) so the client can route to mail capture or confirmation before tapping confirm, instead
    // of bouncing off the reactive 400 in confirmBuy (which stays as a fail-closed backstop for the case the
    // email disappears after this call). An existing quote error takes precedence — it may be a harder block
    // (country/nationality/AML/limit) that no amount of email capture or confirmation can resolve, so the
    // email gates only fill the error when none is present.
    const hasPrimaryEmail = !!userData.mail;
    const isValid = buyPaymentInfo.isValid && hasPrimaryEmail && emailConfirmed;
    const error =
      buyPaymentInfo.error ??
      (!hasPrimaryEmail
        ? QuoteError.PRIMARY_EMAIL_REQUIRED
        : !emailConfirmed
          ? QuoteError.PRIMARY_EMAIL_NOT_CONFIRMED
          : undefined);

    // 6. Override recipient info with RealUnit company address
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
      paymentRequest: isValid
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
      isValid,
      error,
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
      const upstreamMessage = error?.response?.data?.message;
      const message = error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error;
      const logMessage = `Failed to request payment instructions from Aktionariat for request ${requestId} (currency: ${fiat.name}, shares: ${Math.floor(request.estimatedAmount)}, price: ${Math.round(request.amount * 100)}): ${message}`;

      const isMinimumPurchaseRejection =
        error?.response?.status === 400 &&
        typeof upstreamMessage === 'string' &&
        upstreamMessage.includes('Purchases by bank transfer require a minimum');
      if (isMinimumPurchaseRejection) {
        this.logger.warn(logMessage);
        throw new AmountTooLowException(upstreamMessage);
      }

      const isPrimaryEmailMissing =
        error?.response?.status === 400 &&
        typeof upstreamMessage === 'string' &&
        upstreamMessage.includes('User must have a primary email');
      if (isPrimaryEmailMissing) {
        this.logger.warn(logMessage);
        throw new PrimaryEmailRequiredException(upstreamMessage);
      }

      this.logger.error(logMessage);
      throw new ServiceUnavailableException(`Aktionariat API error: ${message}`);
    }

    // Status + Response speichern
    await this.transactionRequestService.confirmTransactionRequest(request, JSON.stringify(aktionariatResponse));

    return { reference: aktionariatResponse.reference };
  }

  // --- Registration Methods ---

  async hasRegistrationForWallet(userData: UserData, walletAddress: string): Promise<boolean> {
    return (await this.findRegistration(userData, walletAddress)).isForCurrentWallet;
  }

  // Bundles the two RealUnit access gates (Aktionariat registration + KYC Level 30) so every RealUnit swap
  // entry point (quote, unsigned-tx build, broadcast) enforces them consistently, not just the initial quote.
  private async assertRealUnitAccess(userData: UserData, walletAddress: string): Promise<void> {
    if (!(await this.hasRegistrationForWallet(userData, walletAddress))) {
      throw new RegistrationRequiredException(undefined, KycContext.REALUNIT_SELL);
    }

    if (userData.kycLevel < KycLevel.LEVEL_30) {
      throw new KycLevelRequiredException(
        KycLevel.LEVEL_30,
        userData.kycLevel,
        'KYC Level 30 required for RealUnit swap',
        KycContext.REALUNIT_SELL,
      );
    }
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

    // mark the account as a RealUnit customer (additive add-on; never read by DFX core logic)
    await this.userDataService.addServiceProvider(userData, ServiceProvider.REALUNIT);

    return RealUnitEmailRegistrationStatus.EMAIL_REGISTERED;
  }

  async completeRegistration(userDataId: number, dto: RealUnitRegistrationDto): Promise<RealUnitRegistrationStatus> {
    await this.validateRegistrationDto(dto);

    // get and validate user
    const userData = await this.userService
      .getUserByAddress(dto.walletAddress, {
        userData: { users: true, country: true, organizationCountry: true },
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

    const { registration: existingRegistration, isForCurrentWallet } = await this.findRegistration(
      userData,
      dto.walletAddress,
    );
    if (isForCurrentWallet) {
      // Signature check FIRST: idempotentRegistrationResult rejects a mismatching signature with a 400,
      // and a request that is about to be rejected must not have mutated the database on its way out.
      const status = await this.idempotentRegistrationResult(userData, existingRegistration!, dto.signature);

      // The snapshot follows the event of record, never the request body. countryAndTINs is NOT part of
      // the EIP-712 envelope, so a replay could otherwise rewrite user_data.tin to something that was
      // never registered with Aktionariat. Syncing from the durable registration row also self-heals a
      // retry whose forward succeeded but whose tin audit write failed.
      const registrationData = this.toRegistrationDto(existingRegistration!);
      if (!registrationData) throw new BadRequestException('Invalid registration data');
      await this.persistUserDataTinAfterRegistration(userData, registrationData);

      return status;
    }

    // validate personal data
    const hasExistingData = userData.firstname != null;
    if (hasExistingData && !this.isPersonalDataMatching(userData, dto)) {
      throw new BadRequestException('Personal data does not match existing data');
    }

    // Personal data first (first-time only). TINs are intentionally NOT written here:
    // user_data.tin is only updated AFTER the registration row is durable so every change
    // is recoverable (see persistUserDataTinAfterRegistration).
    if (!hasExistingData) {
      await this.userDataService.updatePersonalData(userData, dto.kycData);
      await this.userDataService.updateUserDataInternal(userData, {
        nationality: await this.countryService.getCountryWithSymbol(dto.nationality),
        birthday: new Date(dto.birthday),
        language: dto.lang && (await this.languageService.getLanguageBySymbol(dto.lang)),
      });
    }

    // forward to Aktionariat (persists the single-source-of-truth registration row in both branches).
    // signedPayload carries countryAndTINs for this event; superseded rows stay queryable.
    const success = await this.forwardRegistration(userData, dto);
    if (!success) return RealUnitRegistrationStatus.FORWARDING_FAILED;

    await this.persistUserDataTinAfterRegistration(userData, dto);

    return RealUnitRegistrationStatus.COMPLETED;
  }

  // --- Wallet Methods ---

  // The `registrationDate` field is part of the EIP-712 signed registration
  // envelope and is validated server-side (see validateRegistrationDto). The
  // client must therefore sign the date the server considers "today" rather
  // than deriving it from its own local clock — a device in a timezone ahead
  // of UTC would otherwise sign tomorrow's date and be rejected. The client
  // fetches this immediately before signing so it is always the server truth.
  getRegistrationDate(): RealUnitRegistrationDateDto {
    return { date: Util.isoDate(new Date()) };
  }

  async getRegistrationInfo(userData: UserData, walletAddress: string): Promise<RealUnitRegistrationInfoDto> {
    const { registration, isForCurrentWallet } = await this.findRegistration(userData, walletAddress);

    // Dispatch to one of three states so the client can route to the right UX without inferring
    // it locally. Order matters: a registration for the current wallet (ALREADY_REGISTERED)
    // wins over any other signal; a registration for a different wallet drives the one-tap Add-Wallet
    // flow (ADD_WALLET); otherwise this wallet still needs a fresh registration (NEW_REGISTRATION).
    if (registration) {
      const registrationUserData = this.toUserDataDto(registration);
      const state = isForCurrentWallet
        ? RealUnitRegistrationState.ALREADY_REGISTERED
        : RealUnitRegistrationState.ADD_WALLET;
      const { emailConfirmed, confirmedDate } = this.resolveEmailConfirmation(registration);
      return {
        isRegistered: state === RealUnitRegistrationState.ALREADY_REGISTERED,
        state,
        userData: registrationUserData,
        emailConfirmed,
        confirmedDate,
        // Surface a stuck (forward-failed) registration for the current wallet so the app can render a
        // "manual review" screen instead of treating ALREADY_REGISTERED as a completed registration. Only
        // meaningful for the current wallet; an ADD_WALLET other-wallet row is always COMPLETED, so leave it absent.
        manualReview: isForCurrentWallet ? registration.status === ReviewStatus.MANUAL_REVIEW : undefined,
      };
    }

    // No registration exists: this wallet needs a fresh RealUnit registration. Pre-fill the form from
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

  async completeRegistrationForWalletAddress(
    userDataId: number,
    dto: RealUnitRegisterWalletDto,
  ): Promise<RealUnitRegistrationStatus> {
    const userData = await this.userService
      .getUserByAddress(dto.walletAddress, {
        userData: { users: true, country: true },
      })
      .then((u) => u?.userData);

    if (!userData) throw new NotFoundException('User not found');
    if (userData.id !== userDataId) throw new BadRequestException('Wallet address does not belong to user');

    const { registration, isForCurrentWallet } = await this.findRegistration(userData, dto.walletAddress);

    if (isForCurrentWallet) {
      return this.idempotentRegistrationResult(userData, registration!, dto.signature);
    }

    if (!registration) {
      throw new BadRequestException('No RealUnit registration found');
    }

    const registrationData = this.toRegistrationDto(registration);
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

    this.validateRegistrationDate(fullDto.registrationDate);

    const success = await this.forwardRegistration(userData, fullDto);

    return success ? RealUnitRegistrationStatus.COMPLETED : RealUnitRegistrationStatus.FORWARDING_FAILED;
  }

  // The client obtains registrationDate from GET /realunit/register/date (server
  // truth) and signs it, so it can never run ahead of the server. We accept today
  // OR yesterday (UTC) to tolerate the client fetch-sign-submit round-trip
  // straddling a UTC midnight boundary; anything else is stale or forged and is
  // rejected fail-closed. Shared by both registration paths (register/complete and
  // register/wallet) so the signed-date freshness check stays symmetric.
  private validateRegistrationDate(registrationDate: string): void {
    const now = new Date();
    const acceptedDates = [Util.isoDate(now), Util.isoDate(Util.daysBefore(1, now))];
    if (!acceptedDates.includes(registrationDate)) {
      throw new BadRequestException('Registration date must be today or yesterday (UTC)');
    }
  }

  // Residence country (addressCountry) must appear among the declared tax residences.
  // CH is covered ONLY by `swissTaxResidence === true` — never via countryAndTINs (CH has no
  // TIN in this contract). Non-CH countries are covered by a countryAndTINs entry with a
  // non-empty TIN. Additional tax countries beyond the address country are allowed.
  private validateTaxResidenceCoversAddress(dto: RealUnitRegistrationDto): void {
    const entries = dto.countryAndTINs ?? [];

    // Defense in depth: the DTO enforces this too, but the service must never index into a non-array.
    // A non-array body used to reach here (the DTO's @ValidateIf skipped @IsArray whenever
    // swissTaxResidence was true) and crashed with a TypeError => HTTP 500 instead of a 400.
    if (!Array.isArray(entries)) {
      throw new BadRequestException('countryAndTINs must be an array');
    }

    if (entries.length > MAX_TAX_RESIDENCES) {
      throw new BadRequestException(`countryAndTINs must not contain more than ${MAX_TAX_RESIDENCES} entries`);
    }

    if (entries.some((e) => e.country === 'CH')) {
      throw new BadRequestException(
        'countryAndTINs must not include CH; set swissTaxResidence for Swiss tax residence',
      );
    }

    // Nested shape is also enforced here so multi-residence entries stay valid when
    // swissTaxResidence is true (DTO @ValidateIf historically skipped nested checks then).
    for (const entry of entries) {
      if (typeof entry.country !== 'string' || !/^[A-Z]{2}$/.test(entry.country)) {
        throw new BadRequestException('countryAndTINs.country must be a 2-letter country code');
      }
      if (typeof entry.tin !== 'string' || !entry.tin.trim()) {
        throw new BadRequestException('countryAndTINs.tin must be a non-empty string');
      }
      if (entry.tin.length > MAX_TIN_LENGTH) {
        throw new BadRequestException(`countryAndTINs.tin must not exceed ${MAX_TIN_LENGTH} characters`);
      }
    }

    const tinCountries = entries.map((e) => e.country);
    if (new Set(tinCountries).size !== tinCountries.length) {
      throw new BadRequestException('countryAndTINs must not contain duplicate countries');
    }

    if (!dto.swissTaxResidence && entries.length === 0) {
      throw new BadRequestException('countryAndTINs is required when swissTaxResidence is false');
    }

    const taxCountries = new Set(tinCountries);
    if (dto.swissTaxResidence) taxCountries.add('CH');

    if (!taxCountries.has(dto.addressCountry)) {
      throw new BadRequestException(`Tax residence must include the residence country (${dto.addressCountry})`);
    }

    // Fail closed BEFORE anything is forwarded. user_data.tin is a bounded column and is written only
    // AFTER forwardRegistration has persisted the registration — an oversized payload must therefore be
    // rejected here with a 400, never blow up as a 500 on a registration that is already durable.
    const serialized = this.serializeCountryAndTins(entries);
    if (serialized && serialized.length > MAX_SERIALIZED_TIN_LENGTH) {
      throw new BadRequestException('countryAndTINs is too large');
    }
  }

  // Canonical shape for user_data.tin: JSON array of {country, tin}, or null when the
  // submission carries no non-CH tax residences (Swiss-only / empty).
  private serializeCountryAndTins(entries: { country: string; tin: string }[] | undefined): string | null {
    return entries?.length ? JSON.stringify(entries) : null;
  }

  // DFX data rule: overwriting a DB value is only allowed when the previous value remains
  // recoverable. Tax residences are therefore dual-stored:
  //   1) aktionariat_registration.signedPayload — immutable event log (superseded rows kept)
  //   2) user_data.tin — current snapshot for queries
  // This method runs ONLY after forwardRegistration has persisted (1). It never silently
  // destroys a non-null previous tin by writing null (Swiss-only submissions omit
  // countryAndTINs from the new payload, so nulling would lose prior foreign TINs).
  // Every actual mutation is audited with before→after before the column is updated.
  private async persistUserDataTinAfterRegistration(userData: UserData, dto: RealUnitRegistrationDto): Promise<void> {
    const previousTin = userData.tin ?? null;
    const nextTin = this.serializeCountryAndTins(dto.countryAndTINs);

    if (previousTin === nextTin) return;

    // Never clear a stored TIN set to null — that would drop recoverable history from
    // user_data without placing those TINs on the new registration row (Swiss-only payload).
    // Prior foreign TINs stay on user_data until a new non-empty set is submitted; each
    // registration event remains on aktionariat_registration (active + superseded).
    if (nextTin === null && previousTin != null) {
      return;
    }

    // Fail closed on audit: do not overwrite until the before→after event is written.
    await this.logUserDataTinChange(userData.id, dto.walletAddress, previousTin, nextTin);
    await this.userDataService.updateUserDataInternal(userData, { tin: nextTin });
  }

  private async logUserDataTinChange(
    userDataId: number,
    walletAddress: string,
    previousTin: string | null,
    nextTin: string | null,
  ): Promise<void> {
    await this.logService.create({
      system: 'RealUnit',
      subsystem: 'UserDataTin',
      severity: LogSeverity.INFO,
      message: JSON.stringify({
        action: 'user_data.tin change',
        userDataId,
        walletAddress,
        previousTin,
        nextTin,
        changedAt: new Date().toISOString(),
      }),
      category: String(userDataId),
      valid: null,
    });
  }

  private async validateRegistrationDto(dto: RealUnitRegistrationDto): Promise<void> {
    // signature validation
    if (!this.verifyRealUnitRegistrationSignature(dto)) {
      throw new BadRequestException('Invalid signature');
    }

    this.validateRegistrationDate(dto.registrationDate);

    // birthday validation - must be valid date, not in future, not older than 140 years
    const now = new Date();
    const birthday = new Date(dto.birthday);
    if (isNaN(birthday.getTime())) throw new BadRequestException('Invalid birthday date');
    if (birthday > now) throw new BadRequestException('Birthday cannot be in the future');

    const maxAge = new Date(now);
    maxAge.setFullYear(maxAge.getFullYear() - 140);
    if (birthday < maxAge) throw new BadRequestException('Birthday cannot be more than 140 years ago');

    // Tax residence must cover the residence (address) country. `swissTaxResidence`
    // counts as CH; each `countryAndTINs` entry covers its country code. Multi-
    // residence is allowed (additional countries beyond the address country), but
    // the address country itself is mandatory among the declared tax residences —
    // e.g. living in DE requires a DE tax-residence entry (with TIN).
    this.validateTaxResidenceCoversAddress(dto);

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
    return this.resolveRegistrationSignature(data) != null;
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

  // Returns the message exactly as the wallet signed it (Aktionariat re-verifies the
  // forwarded bytes), plus the variant it recovered under; undefined if no accepted
  // shape matches. The chainId-extended domain exists because the BitBox02 refuses
  // chainId-less typed data over Bluetooth (BitBoxSwiss/bitbox02-firmware#2019).
  private resolveRegistrationSignature(data: RealUnitRegistrationDto): ResolvedRegistrationSignature | undefined {
    const { UTF8, BITBOX_ASCII } = RegistrationFieldEncoding;

    const signature = data.signature.startsWith('0x') ? data.signature : `0x${data.signature}`;
    const utf8 = this.buildRegistrationMessage(data, false);
    const ascii = this.buildRegistrationMessage(data, true);

    const isSignedBy = (domain: RegistrationEip712Domain, message: SignedRegistrationMessage): boolean =>
      Util.equalsIgnoreCase(verifyTypedData(domain, REGISTRATION_EIP712_TYPES, message, signature), data.walletAddress);

    const legacy = REGISTRATION_EIP712_DOMAIN;
    if (isSignedBy(legacy, utf8)) return { message: utf8, variant: { domain: legacy, encoding: UTF8 } };
    if (isSignedBy(legacy, ascii)) return { message: ascii, variant: { domain: legacy, encoding: BITBOX_ASCII } };

    // Always set for Ethereum/Sepolia; the guard satisfies the chain map's type.
    const chainId = EvmUtil.getChainId(this.tokenBlockchain);
    if (!chainId) return undefined;

    const extended = { ...REGISTRATION_EIP712_DOMAIN, chainId };
    if (isSignedBy(extended, utf8)) return { message: utf8, variant: { domain: extended, encoding: UTF8 } };
    if (isSignedBy(extended, ascii)) return { message: ascii, variant: { domain: extended, encoding: BITBOX_ASCII } };

    return undefined;
  }

  async forwardRegistrationToAktionariat(id: number): Promise<void> {
    const registration = await this.aktionariatRegistrationRepo.findOne({
      where: { id },
      relations: { user: { userData: true } },
    });
    if (!registration) throw new NotFoundException('RealUnit registration not found');
    if (registration.status !== ReviewStatus.MANUAL_REVIEW) {
      throw new BadRequestException('RealUnit registration is not in MANUAL_REVIEW status');
    }

    const dto = this.toRegistrationDto(registration);
    if (!dto) throw new BadRequestException('No registration data found');

    // This admin retry re-runs the full forwardRegistration, so on a partial prior success it re-POSTs
    // registerUser to Aktionariat. Left as-is in this phase; the per-wallet persistence is idempotent —
    // it supersedes the prior active row rather than colliding with it.
    const success = await this.forwardRegistration(registration.user.userData, dto);
    if (!success) throw new BadRequestException('Failed to forward registration to Aktionariat');
  }

  /**
   * Finds a RealUnit registration for the given account (userData) and wallet, reading the queryable
   * aktionariat_registration table (the single source of truth). First the current wallet: the account's
   * ACTIVE row for this exact address, excluding the terminal FAILED/CANCELED states (mirrors the former
   * `!isFailed && !isCanceled` step filter). Otherwise the newest COMPLETED row for a *different* wallet
   * of the same account, which drives the one-tap Add-Wallet flow. Only COMPLETED other-wallet rows count
   * here — deliberately narrower than the legacy step lookup, which also accepted merge-CANCELED steps.
   * That workaround is now obsolete: a registration hangs on its wallet-user FK and moves to the master
   * account on an account merge, so a merged account's COMPLETED registrations stay directly findable.
   */
  private async findRegistration(
    userData: UserData,
    walletAddress: string,
  ): Promise<{ registration: AktionariatRegistration | undefined; isForCurrentWallet: boolean }> {
    const address = walletAddress.toLowerCase();

    const currentWallet = await this.aktionariatRegistrationRepo.findOne({
      where: {
        user: { userData: { id: userData.id } },
        walletAddress: address,
        active: true,
        status: Not(In([ReviewStatus.FAILED, ReviewStatus.CANCELED])),
      },
      relations: { user: true },
      order: { created: 'DESC' },
    });

    if (currentWallet) {
      return { registration: currentWallet, isForCurrentWallet: true };
    }

    const otherWallet = await this.aktionariatRegistrationRepo.findOne({
      where: {
        user: { userData: { id: userData.id } },
        walletAddress: Not(address),
        status: ReviewStatus.COMPLETED,
      },
      relations: { user: true },
      order: { created: 'DESC' },
    });

    return { registration: otherWallet, isForCurrentWallet: false };
  }

  // Read-back of the per-wallet email-confirmation state for the registration-info endpoint. Both fields live
  // ON the registration row already loaded (single source of truth — no separate table, no join): a
  // registration counts as confirmed when it is grandfathered (requiresEmailConfirmation === false —
  // pre-existing rows the completion migration exempted) OR its first-confirmation latch (confirmedDate) is
  // set. confirmedDate is surfaced as-is.
  private resolveEmailConfirmation(registration: AktionariatRegistration): {
    emailConfirmed: boolean;
    confirmedDate?: Date;
  } {
    const confirmedDate = registration.confirmedDate ?? undefined;
    const emailConfirmed = registration.requiresEmailConfirmation === false || confirmedDate != null;
    return { emailConfirmed, confirmedDate };
  }

  // Reconstructs the full RealUnitRegistrationDto (signed Aktionariat fields + kycData) from a stored
  // registration — the inverse of how forwardRegistration splits the DTO into signedPayload + kycData.
  private toRegistrationDto(registration: AktionariatRegistration): RealUnitRegistrationDto | undefined {
    const signed = registration.signedPayloadData;
    if (!signed) return undefined;

    return { ...signed, kycData: registration.kycDataObj } as RealUnitRegistrationDto;
  }

  /**
   * Idempotent fallback for repeated register/wallet calls (e.g. client retry after a lost
   * response). Same wallet + same EIP-712 signature → return the existing registration's
   * status without inserting a new registration row or re-forwarding. Different signature for the
   * same wallet stays a hard error: it means a fresh sign was produced over conflicting data.
   */
  private async idempotentRegistrationResult(
    userData: UserData,
    registration: AktionariatRegistration,
    incomingSignature: string,
  ): Promise<RealUnitRegistrationStatus> {
    if (!Util.equalsIgnoreCase(registration.signature, incomingSignature)) {
      throw new BadRequestException('RealUnit registration already exists for this wallet with a different signature');
    }

    // The active row reached here is in MANUAL_REVIEW (forward failed, awaiting admin retry) or
    // COMPLETED (forward succeeded) under the normal flow; findRegistration already filters out the
    // terminal FAILED/CANCELED states. Only COMPLETED is a terminal success; every other reachable
    // status falls through to FORWARDING_FAILED, which surfaces the same retry path the client would
    // have seen on the original call.
    // Surface ALREADY_REGISTERED (not COMPLETED) on the idempotent path so clients can distinguish
    // "registration just completed in this call" from "registration was already in place". The
    // wallet-app uses this to skip the post-registration onboarding screens on retry.
    const status =
      registration.status === ReviewStatus.COMPLETED
        ? RealUnitRegistrationStatus.ALREADY_REGISTERED
        : RealUnitRegistrationStatus.FORWARDING_FAILED;

    // Self-heal the best-effort KYC level-20 lift on the idempotent COMPLETED retry (see
    // ensureRegistrationKycLevel): the prior forward completed the registration, so re-assert the lift
    // here in case it did not land the first time. Monotonic and best-effort — never lowers the level,
    // never fails the retry.
    if (registration.status === ReviewStatus.COMPLETED) await this.ensureRegistrationKycLevel(userData);

    this.logger.info(
      `RealUnit registration idempotent retry for userData ${userData.id}, registration ${registration.id} → ${status}`,
    );

    return status;
  }

  // Prefill for ADD_WALLET / ALREADY_REGISTERED is reconstructed from the SIGNED payload on purpose: for
  // BitBox / current-app signers the signed name is the transliterated ASCII variant, and the value must
  // round-trip through EIP-712 re-verification on re-forward. The UTF-8 originals are preserved in kycData
  // (firstName/lastName), which the client uses for exact display; the top-level `name` intentionally
  // mirrors the signed representation.
  private toUserDataDto(registration: AktionariatRegistration | undefined): RealUnitUserDataDto | undefined {
    const registrationData = registration && this.toRegistrationDto(registration);
    if (!registrationData) return undefined;

    const { signature: _sig, walletAddress: _wallet, registrationDate: _date, ...userDataDto } = registrationData;

    return userDataDto as RealUnitUserDataDto;
  }

  // user_data.tin is written exclusively by persistUserDataTinAfterRegistration, as a JSON array of
  // {country, tin} with no CH entry. A malformed or contract-violating legacy value must not take this
  // prefill down: GET registration-info is the only channel through which the user can submit a
  // CORRECTED declaration, so throwing here would lock the account out of the very fix it needs. The
  // bad value is therefore dropped LOUDLY (error log, no PII) and the prefill degrades to "no known tax
  // residences" — it never hands the client back a payload that validateTaxResidenceCoversAddress would
  // reject.
  private parseStoredTin(userData: UserData): { country: string; tin: string }[] {
    if (!userData.tin) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(userData.tin);
    } catch {
      this.logger.error(
        `Malformed user_data.tin for userData ${userData.id}: not valid JSON — prefill degraded to empty`,
      );
      return [];
    }

    if (!Array.isArray(parsed)) {
      this.logger.error(
        `Malformed user_data.tin for userData ${userData.id}: not an array — prefill degraded to empty`,
      );
      return [];
    }

    const entries = parsed.filter(
      (e): e is { country: string; tin: string } =>
        !!e &&
        typeof e.country === 'string' &&
        /^[A-Z]{2}$/.test(e.country) &&
        e.country !== 'CH' &&
        typeof e.tin === 'string' &&
        !!e.tin.trim(),
    );

    if (entries.length !== parsed.length) {
      this.logger.error(
        `user_data.tin for userData ${userData.id} contains ${parsed.length - entries.length} entr(ies) violating the registration contract — dropped from the prefill`,
      );
    }

    return entries;
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
    const tinEntries = this.parseStoredTin(userData);

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
      // Default Swiss tax residence from the country-of-residence signal so a CH-resident
      // pre-fills the common case. The signed payload must still cover addressCountry among
      // the declared tax residences (swissTaxResidence and/or countryAndTINs) — see
      // validateTaxResidenceCoversAddress.
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

  // Forwards a RealUnit registration to Aktionariat and persists the queryable, per-wallet registration row
  // — the single source of truth — in BOTH outcomes: COMPLETED on success (with the forwarded date),
  // MANUAL_REVIEW when the forward fails, so the failure exists as a record an admin can re-forward. No
  // REALUNIT_REGISTRATION kyc_step is created anymore; KYC level 20 is lifted best-effort (self-healing).
  //
  // The Aktionariat POST runs OUTSIDE any DB transaction, so no pooled connection is held across the (up to
  // 30s) external call. Aktionariat's registerUser is idempotent — an upsert keyed on the wallet (register ==
  // update), confirmed with Aktionariat — so if a transient DB failure rolls back the persist after a
  // successful POST, the client retry harmlessly re-POSTs (an update, never a duplicate) and then persists —
  // self-healing, no durable intent row needed. Concurrency is still serialised on the wallet-user by a short
  // per-persist advisory lock plus the partial unique index: two concurrent callers may both (harmlessly)
  // POST, but only one COMPLETED row is written; the second observes it and returns the idempotent success.
  private async forwardRegistration(userData: UserData, dto: RealUnitRegistrationDto): Promise<boolean> {
    const { api } = Config.blockchain.realunit;
    const skipForward = [Environment.DEV, Environment.LOC].includes(Config.environment);

    // forward only Aktionariat fields (exclude kycData to avoid signature verification issues).
    // Aktionariat re-verifies the EIP-712 signature against this payload, so send back the exact
    // representation that was signed — raw UTF-8 (legacy software wallets) or BitBox-safe ASCII
    // (current app / BitBox). Forwarding the wrong variant fails as "Invalid signature". The
    // UTF-8 originals stay on user_data for PDF/mail.
    // A miss still forwards (fallback below) and fails at Aktionariat as "Invalid signature" — the warn attributes it.
    const resolved = this.resolveRegistrationSignature(dto);
    if (resolved) {
      this.logger.info(
        `RealUnit registration signature matched ${describeVariant(resolved.variant)} (${dto.walletAddress})`,
      );
    } else {
      this.logger.warn(`RealUnit registration signature matched no accepted variant (${dto.walletAddress})`);
    }

    const signedMessage = resolved?.message ?? this.buildRegistrationMessage(dto, false);
    const payload: AktionariatRegistrationDto = {
      ...signedMessage,
      signature: dto.signature,
      lang: dto.lang,
      countryAndTINs: dto.countryAndTINs,
    };

    // Resolve the exact wallet-user that owns the signed address (per-wallet FK). Fail closed: without it
    // the queryable record cannot be written, so surface it as a (logged) failure rather than silently
    // dropping the registration. The wallet relation is the source-app attribution for the forward-failure
    // support ticket (RealUnit-branded for a RealUnit wallet).
    const user = await this.userService.getUserByAddress(dto.walletAddress, { wallet: true });
    if (!user) {
      const message = `No user found for RealUnit wallet ${dto.walletAddress}`;
      this.logger.error(`Failed to forward RealUnit registration to Aktionariat: ${message}`);
      await this.logAktionariatRegistration(LogSeverity.ERROR, dto.walletAddress, payload, undefined, message);
      return false;
    }

    const walletAddress = dto.walletAddress.toLowerCase();

    // 1) Forward to Aktionariat OUTSIDE any DB transaction — no pooled connection is held across the call.
    //    Re-POST is safe: registerUser is an idempotent upsert (confirmed with Aktionariat), so a retry
    //    updates rather than duplicates the share-register registration.
    let registerResponse: Record<string, unknown> | undefined;
    let forwardError: unknown;
    if (!skipForward) {
      try {
        registerResponse = await this.http.post<Record<string, unknown>>(`${api.url}/registerUser`, payload, {
          headers: { 'x-api-key': api.key },
          timeout: 30000, // ms — bound the call so a hung Aktionariat cannot stall the request indefinitely.
        });
      } catch (error) {
        forwardError = error;
      }
    }

    // An existing share-register shareholder gets no confirmation email from Aktionariat, so the completed
    // registration must not be gated on one (see isExistingShareholderResponse). Skip-forward (DEV/LOC) and
    // failed forwards have no such response and stay gated by the normal rules.
    const existingShareholder = this.isExistingShareholderResponse(registerResponse);

    // 2) Persist the outcome in a short advisory-locked transaction (no external I/O inside it).
    let outcome: 'completed' | 'forward-failed' | 'idempotent';
    try {
      outcome = await this.aktionariatRegistrationRepo.manager.transaction(async (manager) => {
        // Serialise the persist for this wallet-user (cluster-wide, auto-released at txn end).
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), $2)', ['aktionariat_registration', user.id]);

        // A concurrent caller may have already completed this wallet (both harmlessly POSTed). If so, do not
        // overwrite the COMPLETED row — return the idempotent success.
        const existing = await manager.findOne(AktionariatRegistration, {
          where: { user: { id: user.id }, walletAddress, active: true, status: ReviewStatus.COMPLETED },
        });
        // Same-wallet + same signature → idempotent success (matches idempotentRegistrationResult).
        // A different signature for an already COMPLETED wallet is a hard error: without this check a
        // concurrent double-submit that both passed the outer findRegistration could return success for a
        // conflicting re-sign while the first caller's COMPLETED row stays in place.
        if (existing) {
          if (!Util.equalsIgnoreCase(existing.signature, dto.signature)) {
            throw new BadRequestException(
              'RealUnit registration already exists for this wallet with a different signature',
            );
          }
          return 'idempotent';
        }

        if (forwardError) {
          // The forward failed — record the attempt as MANUAL_REVIEW so it exists as a row an admin can
          // re-forward and a client retry is surfaced as FORWARDING_FAILED.
          await this.persistAktionariatRegistration(manager, user, dto, payload, ReviewStatus.MANUAL_REVIEW, null);
          return 'forward-failed';
        }

        await this.persistAktionariatRegistration(
          manager,
          user,
          dto,
          payload,
          ReviewStatus.COMPLETED,
          new Date(),
          existingShareholder,
        );
        return 'completed';
      });
    } catch (error) {
      // A unique-index violation means a concurrent caller committed the active COMPLETED row first → the
      // registration IS in place (or, given the upsert, will be on their forward) → idempotent success.
      if (this.isUniqueViolation(error)) {
        this.logger.info(
          `RealUnit registration concurrency collision resolved as idempotent for wallet ${dto.walletAddress}`,
        );
        await this.ensureRegistrationKycLevel(userData);
        return true;
      }
      // Signature mismatch on an already COMPLETED row must surface as 400, not as a soft forward failure.
      if (error instanceof BadRequestException) throw error;
      // Any other persist error rolled the persist back. The registration was NOT recorded; return failure.
      // Harmless under the upsert property: the client retry re-POSTs (an update) and persists then.
      this.logger.error(
        `Failed to persist RealUnit registration for wallet ${dto.walletAddress}: ${this.summarizeError(error)}`,
      );
      await this.logAktionariatRegistration(
        LogSeverity.ERROR,
        dto.walletAddress,
        payload,
        registerResponse,
        forwardError ?? error,
      );
      return false;
    }

    if (outcome === 'forward-failed') {
      this.logger.error(
        `Failed to forward RealUnit registration to Aktionariat for wallet ${dto.walletAddress}: ${this.summarizeError(
          forwardError,
        )}`,
      );
      await this.logAktionariatRegistration(
        LogSeverity.ERROR,
        dto.walletAddress,
        payload,
        registerResponse,
        forwardError,
      );
      // The MANUAL_REVIEW row is committed above; surface the stuck onboarding to staff for a manual re-forward.
      await this.openForwardFailureSupportIssue(userData, user.wallet, dto.walletAddress);
      return false;
    }

    // completed or idempotent: lift KYC level (best-effort, self-healing) and write the INFO audit log.
    await this.ensureRegistrationKycLevel(userData);
    await this.logAktionariatRegistration(
      LogSeverity.INFO,
      dto.walletAddress,
      payload,
      skipForward ? 'skipped (DEV/LOC)' : registerResponse,
    );
    return true;
  }

  // Best-effort KYC level-20 lift for a completed RealUnit registration. Runs AFTER the COMPLETED row is
  // durably persisted, so a transient failure here must not turn a durable registration into a 500 — it is
  // logged and self-heals on the next completeRegistration idempotent retry, which re-asserts it. Monotonic:
  // updateUserDataInternal never lowers kycLevel. Not folded into the persist transaction on purpose:
  // updateUserDataInternal runs its own repository and fires KYC-changed notifications (side-effects that
  // must not run inside, nor be rolled back with, the registration persist).
  private async ensureRegistrationKycLevel(userData: UserData): Promise<void> {
    if (userData.kycLevel >= KycLevel.LEVEL_20) return;
    try {
      await this.userDataService.updateUserDataInternal(userData, { kycLevel: KycLevel.LEVEL_20 });
    } catch (e) {
      this.logger.error(
        `Failed to lift KYC level for RealUnit registration (userData ${userData.id}); will self-heal on retry: ${e?.message || e}`,
      );
    }
  }

  // Aktionariat's registerUser answers "Existing user found, updated your address." when the signed email
  // already belongs to a share-register shareholder: it updates that shareholder's wallet in place and sends
  // NO confirmation email (a newly registered email instead gets "Confirmation email sent to ..."). Such a
  // registration must not be gated on a confirmation email that never arrives — Aktionariat has
  // authoritatively identified an existing shareholder, which is itself the confirmation.
  private isExistingShareholderResponse(response: Record<string, unknown> | undefined): boolean {
    const message = typeof response?.message === 'string' ? response.message : undefined;
    return message?.toLowerCase().startsWith(RealUnitService.existingShareholderMarker) ?? false;
  }

  // Persist the queryable, per-wallet Aktionariat registration record for the resolved wallet-user within
  // the caller's transaction (the caller holds the per-wallet-user advisory lock). Deactivate any prior
  // active registration for this wallet-user, then insert the new one — so the partial unique index
  // ("userId") WHERE active = true always holds and a re-registration or admin retry supersedes (rather
  // than collides with) the existing active row. The superseded row is kept as history (active = false),
  // never deleted. The queryable walletAddress column is canonically lowercased for the exact-match confirm
  // lookup; signedPayloadData keeps the exact signed casing.
  private async persistAktionariatRegistration(
    manager: EntityManager,
    user: User,
    dto: RealUnitRegistrationDto,
    payload: AktionariatRegistrationDto,
    status: ReviewStatus,
    forwardedToAktionariatDate: Date | null,
    existingShareholder = false,
  ): Promise<void> {
    await manager.update(AktionariatRegistration, { user: { id: user.id }, active: true }, { active: false });

    const registration = this.aktionariatRegistrationRepo.create({
      user,
      walletAddress: dto.walletAddress.toLowerCase(),
      email: dto.email,
      registrationDate: dto.registrationDate,
      signature: dto.signature,
      status,
      forwardedToAktionariatDate: forwardedToAktionariatDate ?? undefined,
      active: true,
      // A COMPLETED registration is gated on the Aktionariat confirmation email (sent on a successful forward)
      // UNLESS Aktionariat matched an existing shareholder — it then sends no confirmation email, so gating
      // would dead-end the flow on a mail that never arrives. A MANUAL_REVIEW row's forward failed, so no mail
      // was sent either. (The completion migration clears this for rows that predate the gate.)
      requiresEmailConfirmation: status === ReviewStatus.COMPLETED && !existingShareholder,
    });
    registration.signedPayloadData = payload;
    registration.kycDataObj = dto.kycData;

    await manager.save(registration);
  }

  // Audit mirror of the Aktionariat communication into the DB `log` table. The DB log is the DESIGNATED
  // PII audit store (its own access-control/retention), UNLIKE Loki (the PII-free channel used by the
  // this.logger.* lines), so it records the FULL communication — the exact sent payload, the full
  // Aktionariat response, and the full error body — for a complete, replayable audit trail. Best-effort:
  // a logging failure must never fail the registration, but it is surfaced loudly (never swallowed).
  private async logAktionariatRegistration(
    severity: LogSeverity,
    walletAddress: string,
    request: AktionariatRegistrationDto,
    response: unknown,
    error?: unknown,
  ): Promise<void> {
    try {
      await this.logService.create({
        system: 'Aktionariat',
        subsystem: 'Registration',
        severity,
        message: JSON.stringify({
          action: 'registerUser',
          walletAddress,
          request,
          response,
          error: this.describeError(error),
        }),
        category: walletAddress,
        valid: null,
      });
    } catch (e) {
      this.logger.error(
        `Failed to write Aktionariat communication log for wallet ${walletAddress}: ${e?.message || e}`,
      );
    }
  }

  // Best-effort: open (or dedup into) a support ticket when a RealUnit registration fails to forward to
  // Aktionariat and is parked as MANUAL_REVIEW — so the stuck onboarding surfaces to staff for a manual
  // re-forward instead of only living in a log line. createIssueInternal dedups on (userData, type, reason),
  // so a client/admin retry appends to the same ticket rather than spamming new ones. Never fails or rolls
  // back the (already committed) registration persist: a ticket failure is logged and swallowed, exactly like
  // the audit-log best-effort above.
  private async openForwardFailureSupportIssue(
    userData: UserData,
    sourceWallet: Wallet,
    walletAddress: string,
  ): Promise<void> {
    try {
      const dto: CreateSupportIssueDto = {
        type: SupportIssueType.KYC_ISSUE,
        reason: SupportIssueReason.AKTIONARIAT_FORWARDING_FAILED,
        department: Department.SUPPORT,
        name: 'RealUnit Aktionariat registration - forwarding failed',
        author: CustomerAuthor,
        message: `RealUnit Aktionariat registration forwarding failed for wallet ${walletAddress}. The registration is stored as MANUAL_REVIEW and needs a manual re-forward to Aktionariat.`,
      };
      await this.supportIssueService.createIssueInternal(userData, dto, sourceWallet);
    } catch (e) {
      this.logger.error(
        `Failed to open support ticket for RealUnit registration forward failure (wallet ${walletAddress}): ${e?.message || e}`,
      );
    }
  }

  // Full, JSON-serialisable error content for the DB log (the PII audit store): the Aktionariat HTTP error
  // body when it carries content (the useful, complete part) — an empty or null body falls through so the
  // error identity is not lost — else a string as-is, else an Error's name+message, else the raw value.
  // Not for Loki — the this.logger.* lines use summarizeError (redacted) instead.
  private describeError(error: unknown): unknown {
    if (error == null) return undefined;
    const e = error as any;
    if (e.response?.data != null && e.response.data !== '') return e.response.data;
    if (typeof error === 'string') return error;
    if (error instanceof Error) return { name: error.name, message: error.message };
    return error;
  }

  // Redacted summary of a forward/persist error for the Loki app-log (this.logger.*); the DB log stores the
  // full error via describeError. An HTTP error from Aktionariat may echo the submitted email/name in its
  // body, so only the status and error type are kept; other errors (network / DB, no submitted PII) use
  // their message.
  private summarizeError(error: unknown): string | undefined {
    if (error == null) return undefined;
    const e = error as any;
    if (e.response)
      return `status=${e.response.status ?? 'unknown'} type=${e.name ?? e.constructor?.name ?? 'HttpError'}`;
    if (typeof error === 'string') return error;
    return e.message ?? String(error);
  }

  // Postgres unique_violation (SQLSTATE 23505): a concurrent caller already committed the active row.
  private isUniqueViolation(error: unknown): boolean {
    return (error as any)?.code === '23505';
  }

  // --- Sell Payment Info Methods ---

  async getSellPaymentInfo(user: User, dto: RealUnitSellDto): Promise<RealUnitSellPaymentInfoDto> {
    const userData = user.userData;
    const currencyName = dto.currency ?? 'CHF';

    // 1. Registration required
    if (!(await this.hasRegistrationForWallet(userData, user.address))) {
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

  // --- Swap Quote Methods (IBAN-free REALU -> ZCHF) --- //

  // Step 0 of the OCP pay flow: produces a SWAP-type TransactionRequest for REALU -> ZCHF WITHOUT a fiat
  // IBAN, Sell route or payout — the ZCHF proceeds stay in the user wallet so they can be paid at an OCP/SPAR
  // POS. A RealUnit holder paying at a POS need not have a DFX sell bank account, so requiring an IBAN (as
  // the /sell quote does) would be a hard UX blocker. The request id returned here feeds
  // `createSwapUnsignedTransaction` (PUT /swap/:id/unsigned-transaction).
  //
  // Gating mirrors the sell path's access gates (registration + KYC Level 30) — these decide WHO may use the
  // RealUnit features at all and are enforced here. KYC TRADING LIMITS, however, do NOT apply to this swap:
  // they are enforced at the fiat boundary (buy/sell), whereas a REALU -> ZCHF swap is a crypto -> crypto,
  // self-custody, on-chain Aktionariat-brokerbot action that DFX only relays. The existing non-fiat RealUnit
  // carve-out in TransactionHelper.getLimits returns Number.MAX_VALUE for every RealUnit transaction that is
  // not selling-REALU-for-fiat, so QuoteError.LIMIT_EXCEEDED can never fire for this pair (see step 5 below).
  // We deliberately reuse the existing crypto Swap-route machinery (TransactionRequestType.SWAP) so this is a
  // genuine SWAP request — NOT a Sell — and no fiat route/IBAN is created.
  //
  // Design note: the standard SwapService payment-info models a DFX-custody swap (user deposits the source
  // asset to a DFX deposit address). For RealUnit the on-chain execution stays the already-built user-signed
  // brokerbot mechanism (buildSwapUnsignedTransaction), so the swap-route deposit address is unused here — we
  // only consume the route binding, the quote, and the SWAP-type TransactionRequest. includeTx
  // is false so no DFX-custody deposit tx is built.
  async getSwapPaymentInfo(user: User, dto: RealUnitSwapDto): Promise<RealUnitSwapPaymentInfoDto> {
    const userData = user.userData;

    // 1+2. Registration + KYC Level 30 required (bundled gate, also enforced in the two swap-tx methods below)
    await this.assertRealUnitAccess(userData, user.address);

    // 3. Get assets (source REALU -> target ZCHF)
    const [realuAsset, zchfAsset] = await Promise.all([this.getRealuAsset(), this.getZchfAsset()]);
    if (!realuAsset) throw new NotFoundException('REALU asset not found');
    if (!zchfAsset) throw new NotFoundException('ZCHF asset not found');

    // 4. Create the SWAP quote + SWAP-type TransactionRequest via the crypto Swap-route machinery (IBAN-free).
    // includeTx=false: the on-chain execution uses the user-signed brokerbot tx, not a DFX-custody deposit tx
    // (see design note above).
    const includeTx = false;
    const swapPaymentInfo = await this.withPriceSourceGuard(() =>
      this.swapService.createSwapPaymentInfo(
        user.id,
        {
          sourceAsset: realuAsset,
          targetAsset: zchfAsset,
          amount: dto.amount,
          targetAmount: dto.targetAmount,
          exactPrice: false,
        },
        includeTx,
      ),
    );

    // 5. No KYC-trading-limit throw here BY DESIGN. KYC trading limits are enforced at the fiat boundary
    // (buy/sell); a REALU -> ZCHF swap is a crypto -> crypto, self-custody, on-chain Aktionariat-brokerbot
    // action and is limit-exempt by the existing non-fiat RealUnit carve-out in TransactionHelper.getLimits
    // (it returns Number.MAX_VALUE for any RealUnit tx that is not selling-REALU-for-fiat), so the quote can
    // never carry QuoteError.LIMIT_EXCEEDED for this pair. We still surface any genuine quote error (e.g.
    // min/max volume) via isValid/error on the returned DTO, but we do NOT map a limit error to a KYC level
    // here — that would be misleading dead code. Do not re-add a LIMIT_EXCEEDED -> KYC-level throw.

    // 6. Fetch gas info and anchor the estimated ZCHF against the live on-chain brokerbot price (same as sell)
    const evmClient = this.getEvmClient();
    const shares = Math.floor(swapPaymentInfo.amount);
    const [ethBalance, gasPrice, brokerbotResult] = await Promise.all([
      evmClient.getNativeCoinBalanceForAddress(user.address),
      evmClient.getRecommendedGasPrice(),
      shares > 0
        ? this.blockchainService.getBrokerbotSellPrice(this.getBrokerbotAddress(), shares).catch(() => {
            throw new PriceSourceUnavailableException();
          })
        : Promise.resolve(null),
    ]);

    let estimatedAmount = swapPaymentInfo.estimatedAmount;
    if (brokerbotResult && swapPaymentInfo.id) {
      estimatedAmount = EvmUtil.fromWeiAmount(
        ethers.BigNumber.from(brokerbotResult.zchfAmountWei.toString()),
        zchfAsset.decimals,
      );
      await this.transactionRequestService.updateEstimatedAmount(swapPaymentInfo.id, estimatedAmount);
    }

    // Swap-only gas: 350k for the single brokerbotSell step (no deposit leg)
    const swapGasLimit = ethers.BigNumber.from(350_000);
    const requiredGasEth = EvmUtil.fromWeiAmount(gasPrice.mul(swapGasLimit));

    return {
      id: swapPaymentInfo.id,
      uid: swapPaymentInfo.uid,
      routeId: swapPaymentInfo.routeId,
      timestamp: swapPaymentInfo.timestamp,
      amount: shares,
      estimatedAmount,
      targetAsset: zchfAsset.name,
      fees: swapPaymentInfo.fees,
      minVolume: swapPaymentInfo.minVolume,
      maxVolume: swapPaymentInfo.maxVolume,
      minVolumeTarget: swapPaymentInfo.minVolumeTarget,
      maxVolumeTarget: swapPaymentInfo.maxVolumeTarget,
      ethBalance,
      requiredGasEth,
      isValid: shares < 1 ? false : swapPaymentInfo.isValid,
      error: shares < 1 ? QuoteError.AMOUNT_TOO_LOW : swapPaymentInfo.error,
    };
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
    const shares = Math.floor(request.amount);
    const swap = this.buildSwapUnsignedTransaction(client.chainId, realuAsset, shares, nonce, gasPrice, swapGasLimit);

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
    return this.broadcastSignedTransaction(userId, requestId, dto);
  }

  // Dedicated swap broadcast (PUT /swap/:id/broadcast) for clean OCP-flow semantics: the app broadcasts a
  // swap via a /swap/* route, not a /sell/* one. Validates the signed payload against the server-known
  // request (re-derived transferAndCall calldata), broadcasts, then marks the request complete so a
  // second broadcast is rejected by the isComplete guard (replay protection).
  async broadcastSwapTransaction(
    userId: number,
    requestId: number,
    dto: RealUnitSellBroadcastDto,
  ): Promise<{ txHash: string }> {
    const request = await this.transactionRequestService.getOrThrow(requestId, userId);

    if (request.type !== TransactionRequestType.SWAP) throw new BadRequestException('Not a swap request');
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');

    const [realuAsset, zchfAsset] = await Promise.all([this.getRealuAsset(), this.getZchfAsset()]);
    if (!realuAsset) throw new NotFoundException('REALU asset not found');
    if (!zchfAsset) throw new NotFoundException('ZCHF asset not found');
    if (request.sourceId !== realuAsset.id || request.targetId !== zchfAsset.id) {
      throw new BadRequestException('Swap request source/target asset does not match REALU/ZCHF');
    }
    await this.assertRealUnitAccess(request.user.userData, request.user.address);

    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');

    const signedHex = this.reconstructSignedTransaction(dto);

    const client = this.getEvmClient();
    let parsedTx: ReturnType<typeof ethers.utils.parseTransaction>;
    try {
      parsedTx = ethers.utils.parseTransaction(signedHex);
    } catch {
      throw new BadRequestException('Invalid signed transaction');
    }
    const expectedData = this.buildSwapCalldata(realuAsset, Math.floor(request.amount));

    // Fail-closed: the signed tx the client broadcasts must match what the server built for THIS request —
    // recipient contract, chain, value and calldata are all re-derived server-side rather than trusted from
    // the client-supplied unsignedTx, so a mismatched/forged payload never reaches the network. The recovered
    // signer must also match the request's user address, so an attacker cannot relay a transaction signed
    // by a different wallet than the KYC'd requester.
    const payloadMatches =
      parsedTx.to != null &&
      Util.equalsIgnoreCase(parsedTx.to, realuAsset.chainId) &&
      parsedTx.chainId === client.chainId &&
      parsedTx.value.isZero() &&
      Util.equalsIgnoreCase(parsedTx.data, expectedData) &&
      parsedTx.from != null &&
      Util.equalsIgnoreCase(parsedTx.from, request.user.address);

    if (!payloadMatches) {
      throw new BadRequestException('Signed swap transaction does not match the expected request payload');
    }

    const result = await client.sendSignedTransaction(signedHex);

    if (result.error) throw new BadRequestException(`Broadcast failed: ${result.error.message}`);

    const txHash = result.response?.hash;
    if (!txHash) throw new BadRequestException('Broadcast returned no transaction hash');

    await this.transactionRequestService.complete(request.id);
    await this.faucetRequestService.resetFaucet(userId);

    return { txHash };
  }

  // Shared broadcast: validates the TransactionRequest, reconstructs the user-signed EIP-1559 hex and submits
  // it to the network. Used by both the sell broadcast and the swap broadcast (REALU -> ZCHF brokerbot tx).
  private async broadcastSignedTransaction(
    userId: number,
    requestId: number,
    dto: RealUnitSellBroadcastDto,
  ): Promise<{ txHash: string }> {
    const request = await this.transactionRequestService.getOrThrow(requestId, userId);
    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');

    const signedHex = this.reconstructSignedTransaction(dto);

    const client = this.getEvmClient();
    const result = await client.sendSignedTransaction(signedHex);

    if (result.error) throw new BadRequestException(`Broadcast failed: ${result.error.message}`);

    const txHash = result.response?.hash;
    if (!txHash) throw new BadRequestException('Broadcast returned no transaction hash');

    await this.faucetRequestService.resetFaucet(userId);

    return { txHash };
  }

  // --- Shared EVM Transaction Helpers --- //

  // Builds the ERC-677 `transferAndCall` calldata that sends REALU shares to the brokerbot. Pure function of
  // (realuAsset, shares) — reused by buildSwapUnsignedTransaction (build time) and broadcastSwapTransaction
  // (fail-closed payload validation before broadcast: re-derives the expected calldata from the server-known
  // request instead of trusting whatever `to`/`data` the client attaches to the signed tx).
  private buildSwapCalldata(realuAsset: Asset, shares: number): string {
    const erc677Interface = new ethers.utils.Interface([
      'function transferAndCall(address to, uint256 value, bytes data) returns (bool)',
    ]);
    const swapAmountWei = ethers.utils.parseUnits(shares.toString(), realuAsset.decimals ?? 18);
    return erc677Interface.encodeFunctionData('transferAndCall', [this.getBrokerbotAddress(), swapAmountWei, '0x']);
  }

  // Builds the unsigned REALU `transferAndCall` (ERC-677) swap tx that sends REALU shares to the brokerbot.
  // The brokerbot pays out ZCHF to the sender wallet — shared by the sell flow (deposit follows) and the
  // OCP swap-only flow (ZCHF stays in the user wallet, no deposit leg).
  private buildSwapUnsignedTransaction(
    chainId: number,
    realuAsset: Asset,
    shares: number,
    nonce: number,
    gasPrice: BigNumber,
    gasLimit: BigNumber,
  ): string {
    const swapData = this.buildSwapCalldata(realuAsset, shares);

    return ethers.utils.serializeTransaction({
      type: 2,
      chainId,
      nonce,
      maxPriorityFeePerGas: gasPrice,
      maxFeePerGas: gasPrice,
      gasLimit,
      to: realuAsset.chainId,
      value: ethers.BigNumber.from(0),
      data: swapData,
      accessList: [],
    });
  }

  // Reconstructs the signed EIP-1559 transaction hex from a previously built unsigned tx and the user signature.
  // The unsigned hex is re-serialized with the signature so the network accepts it; shared by the sell broadcast
  // and the OCP pay submission paths. Fail-closed on a syntactically broken unsignedTx (parse/serialize)
  // with BadRequestException instead of a raw ethers 500.
  private reconstructSignedTransaction(dto: RealUnitSellBroadcastDto): string {
    const { unsignedTx, r, s, v } = dto;

    try {
      const parsed = ethers.utils.parseTransaction(unsignedTx);
      if (!parsed.maxPriorityFeePerGas || !parsed.maxFeePerGas) {
        throw new Error('Unsigned transaction is missing EIP-1559 fee fields');
      }

      return ethers.utils.serializeTransaction(
        {
          type: 2,
          chainId: parsed.chainId,
          nonce: parsed.nonce,
          maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
          maxFeePerGas: parsed.maxFeePerGas,
          gasLimit: parsed.gasLimit,
          to: parsed.to,
          value: parsed.value,
          data: parsed.data,
          accessList: parsed.accessList ?? [],
        },
        { r, s, v },
      );
    } catch {
      throw new BadRequestException('Invalid unsigned transaction');
    }
  }

  // Parses a signed EIP-1559 hex and decodes its ERC-20 transfer() calldata. Wraps both throwing ethers
  // calls so a client-supplied signed tx with an invalid/garbage calldata surfaces as a typed
  // BadRequestException (400) instead of an uncaught ethers parse/decode error (raw 500).
  private parseSignedErc20Transfer(signedHex: string): {
    parsedTx: ReturnType<typeof ethers.utils.parseTransaction>;
    amount: BigNumber;
  } {
    try {
      const parsedTx = ethers.utils.parseTransaction(signedHex);
      const { amount } = EvmUtil.decodeErc20Transfer(parsedTx.data);
      return { parsedTx, amount };
    } catch {
      throw new BadRequestException('Invalid unsigned transaction');
    }
  }

  private getEvmClient(): EvmClient {
    return [Environment.DEV, Environment.LOC].includes(Config.environment)
      ? this.sepoliaService.getDefaultClient()
      : this.ethereumService.getDefaultClient();
  }

  // --- OCP Pay-Flow Methods --- //
  // Phase 2 pay flow: (1) swap REALU -> ZCHF keeping the ZCHF in the user wallet, then
  // (2) pay that ZCHF to an Open CryptoPay recipient via the public lnurlp payment-link flow.
  // The client cannot build EVM calldata locally, so the backend builds the unsigned txs and
  // submits the reconstructed signed hex into the existing lnurlp settlement path.

  // Step 1 (swap-only): builds the REALU -> ZCHF swap tx WITHOUT the deposit sweep, so the ZCHF
  // proceeds land in the user wallet. Reuses the sell unsigned-tx machinery via buildSwapUnsignedTransaction.
  async createSwapUnsignedTransaction(userId: number, requestId: number): Promise<{ swap: string }> {
    const request = await this.transactionRequestService.getOrThrow(requestId, userId);

    if (request.type !== TransactionRequestType.SWAP) throw new BadRequestException('Not a swap request');
    if (request.isComplete) throw new ConflictException('Transaction request is already confirmed');

    const client = this.getEvmClient();
    const [realuAsset, zchfAsset] = await Promise.all([this.getRealuAsset(), this.getZchfAsset()]);
    if (!realuAsset) throw new NotFoundException('REALU asset not found');
    if (!zchfAsset) throw new NotFoundException('ZCHF asset not found');
    if (request.sourceId !== realuAsset.id || request.targetId !== zchfAsset.id) {
      throw new BadRequestException('Swap request source/target asset does not match REALU/ZCHF');
    }
    await this.assertRealUnitAccess(request.user.userData, request.user.address);

    if (!request.isValid) throw new BadRequestException('Transaction request is not valid');
    if (!realuAsset.chainId) throw new BadRequestException('REALU asset has no contract address');

    // Accepted residual risk: two near-simultaneous build calls for the same wallet can read the same
    // pending nonce, causing a benign on-chain replace/reject for one of the two txs — no fund loss.
    // Deliberately not reserving/locking the nonce here.
    const [nonce, gasPrice] = await Promise.all([
      client.getTransactionCount(request.user.address, 'pending'),
      client.getRecommendedGasPrice(),
    ]);

    const swapGasLimit = ethers.BigNumber.from(350_000);
    const ethBalance = await client.getNativeCoinBalanceForAddress(request.user.address);
    const requiredEth = EvmUtil.fromWeiAmount(gasPrice.mul(swapGasLimit));
    if (ethBalance < requiredEth) {
      throw new BadRequestException(
        `Insufficient ETH for gas: need ${requiredEth.toFixed(6)} ETH, have ${ethBalance.toFixed(6)} ETH`,
      );
    }

    const shares = Math.floor(request.amount);
    if (shares < 1) throw new BadRequestException('Swap amount rounds down to zero shares');

    const swap = this.buildSwapUnsignedTransaction(client.chainId, realuAsset, shares, nonce, gasPrice, swapGasLimit);

    return { swap };
  }

  // Step 2a: builds the unsigned ZCHF ERC-20 transfer tx for an OCP payment. Recipient and exact amount are
  // resolved from the payment-link/quote service (same source the lnurlp callback uses) by activating the
  // quote and parsing the returned EVM payment URI.
  async createOcpPayUnsignedTransaction(
    senderAddress: string,
    paymentLinkId: string,
    quoteId: string,
  ): Promise<RealUnitOcpPayUnsignedTransactionDto> {
    const zchfAsset = await this.getZchfAsset();
    if (!zchfAsset) throw new NotFoundException('ZCHF asset not found');
    if (!zchfAsset.chainId) throw new BadRequestException('ZCHF asset has no contract address');

    // Guard against payment methods the payment-link engine cannot settle before touching it. The resolved
    // method is SEPOLIA on DEV/LOC and ETHEREUM on PRD; both are supported EVM methods, so this passes for
    // the RealUnit flow and OCP is testable end-to-end on Sepolia (non-PRD). The guard still fails fast with
    // a clear, typed error for any genuinely-unsupported method.
    this.assertPaymentLinkSupportsMethod();

    // Activate the quote via the same path as the lnurlp callback to obtain the DFX deposit recipient and amount
    const activation = await this.lnUrlForwardService.lnurlpCallbackForward(paymentLinkId, {
      method: this.tokenBlockchain,
      asset: zchfAsset.name,
      quote: quoteId,
    });

    if (!('uri' in activation) || !activation.uri) {
      throw new BadRequestException('OCP quote did not return an EVM payment request');
    }

    const { recipient, amountWei } = this.parseEvmPaymentRequest(activation.uri, zchfAsset);

    const client = this.getEvmClient();

    // Fail-closed: the pay tx must not be built until the sender actually holds enough ZCHF on-chain.
    // ZCHF only exists after the REALU→ZCHF swap has been mined; without this check a pay tx can be
    // queued (pending nonce) and marked COMPLETED at TX_MEMPOOL while the swap failed or never settled.
    const zchfBalanceWei = await client.getTokenBalanceWei(zchfAsset, senderAddress);
    if (zchfBalanceWei.lt(amountWei)) {
      throw new ConflictException('Insufficient ZCHF balance — swap not yet settled');
    }

    // Use the `pending` nonce: in the documented flow the swap tx (broadcast via PUT /v1/realunit/swap/:id/broadcast)
    // may still be in the mempool when this pay tx is built. Counting pending txs avoids reusing the
    // swap tx nonce, which would otherwise make both txs collide on the same nonce.
    // Accepted residual risk: this shares the same pending-nonce race as the swap build — a benign
    // on-chain replace/reject at worst, never fund loss. Deliberately not reserving/locking the nonce.
    const [nonce, gasPrice] = await Promise.all([
      client.getTransactionCount(senderAddress, 'pending'),
      client.getRecommendedGasPrice(),
    ]);

    const transferGasLimit = ethers.BigNumber.from(100_000);
    // Extra 20% buffer on top of the already-buffered recommended gas price: the payment-link engine's minFee is a
    // snapshot from OCP-quote time, and a network gas-price drop between quote and this tx build can otherwise push
    // maxFeePerGas below that stale minFee, failing /pay/submit after the swap already executed.
    const bufferedMaxFeePerGas = gasPrice.mul(120).div(100);

    const ethBalance = await client.getNativeCoinBalanceForAddress(senderAddress);
    const requiredEth = EvmUtil.fromWeiAmount(bufferedMaxFeePerGas.mul(transferGasLimit));
    if (ethBalance < requiredEth) {
      throw new BadRequestException(
        `Insufficient ETH for gas: need ${requiredEth.toFixed(6)} ETH, have ${ethBalance.toFixed(6)} ETH`,
      );
    }

    const transferData = EvmUtil.encodeErc20Transfer(recipient, amountWei);
    const unsignedTx = ethers.utils.serializeTransaction({
      type: 2,
      chainId: client.chainId,
      nonce,
      maxPriorityFeePerGas: gasPrice,
      maxFeePerGas: bufferedMaxFeePerGas,
      gasLimit: transferGasLimit,
      to: zchfAsset.chainId,
      value: ethers.BigNumber.from(0),
      data: transferData,
      accessList: [],
    });

    return {
      unsignedTx,
      tokenAddress: zchfAsset.chainId,
      recipient,
      amountWei: amountWei.toString(),
      chainId: zchfAsset.evmChainId,
    };
  }

  // Step 2b: reconstructs the user-signed hex and submits it into the existing lnurlp tx settlement path so
  // DFX validates (recipient / amount / min-fee / ERC-20 selector), broadcasts, and settles the OCP quote.
  // Auth note: the JWT (USER guard) is an access gate, NOT an ownership check — an OCP payment-link quote is
  // a POS payment payable by whoever holds the quote, and the downstream lnurlp path re-validates
  // recipient / amount / min-fee server-side.
  async submitOcpPay(dto: RealUnitOcpPaySubmitDto): Promise<RealUnitOcpPayResultDto> {
    const zchfAsset = await this.getZchfAsset();
    if (!zchfAsset) throw new NotFoundException('ZCHF asset not found');
    if (!zchfAsset.chainId) throw new BadRequestException('ZCHF asset has no contract address');

    // Guard against payment methods the payment-link engine cannot settle — see createOcpPayUnsignedTransaction.
    this.assertPaymentLinkSupportsMethod();

    const signedHex = this.reconstructSignedTransaction(dto);

    // Defense-in-depth: re-check ZCHF sufficiency immediately before submitting into the payment-link
    // engine (TOCTOU gap between createOcpPayUnsignedTransaction and this submit — sender may have
    // moved ZCHF elsewhere). Sender and amount are derived from the signed hex itself.
    const { parsedTx, amount: transferAmountWei } = this.parseSignedErc20Transfer(signedHex);
    if (!parsedTx.from) throw new BadRequestException('Unable to recover sender address from signed transaction');

    const client = this.getEvmClient();
    const zchfBalanceWei = await client.getTokenBalanceWei(zchfAsset, parsedTx.from);
    if (zchfBalanceWei.lt(transferAmountWei)) {
      throw new ConflictException('Insufficient ZCHF balance — swap not yet settled');
    }

    const result = await this.lnUrlForwardService.txHexForward(dto.paymentLinkId, {
      method: this.tokenBlockchain,
      asset: zchfAsset.name,
      quote: dto.quoteId,
      hex: signedHex,
    });

    return { txId: result.txId };
  }

  // Step 3: exposes the OCP payment status via a status-independent payment-link lookup
  // (getMostRecentPayment), so COMPLETED/EXPIRED/etc. are returned instead of 404 after PENDING ends.
  // Auth note: the JWT (USER guard) is an access gate, NOT an ownership check — an OCP payment-link quote is
  // a POS payment payable by whoever holds the quote, and the downstream lnurlp path re-validates
  // recipient / amount / min-fee server-side.
  async getOcpPayStatus(paymentLinkId: string): Promise<RealUnitOcpPayStatusDto> {
    // see #4276 — status-independent lookup; COMPLETED/EXPIRED/etc. are returned instead of 404
    const payment = await this.paymentLinkPaymentService.getMostRecentPayment(paymentLinkId);
    if (!payment) throw new NotFoundException('Payment not found');

    return { status: payment.status };
  }

  // Guards the OCP pay endpoints against payment methods the payment-link engine cannot settle. The resolved
  // method (SEPOLIA on DEV/LOC, ETHEREUM on PRD) is a supported EVM method, so this passes for the RealUnit
  // flow. It still fails fast with a clear, typed error for any genuinely-unsupported method instead of
  // letting a deep, opaque `Invalid method` bubble up from PaymentRequestMapper / executeHexPayment.
  // tokenBlockchain is server config only (never client input) — a mismatch is a deployment/config problem
  // (503), not a bad client request (400).
  private assertPaymentLinkSupportsMethod(): void {
    if (!PaymentLinkEvmHexBlockchains.includes(this.tokenBlockchain)) {
      throw new ServiceUnavailableException(
        `OCP pay is not available for ${this.tokenBlockchain}: the payment-link engine supports EVM methods only`,
      );
    }
  }

  // Parses an ERC-20 EVM payment request URI of the form
  // `ethereum:<tokenContract>@<chainId>/transfer?address=<recipient>&uint256=<amount>` into recipient + amount.
  // Cross-checks the token contract in the URI path against the expected ZCHF asset and validates the
  // recipient/amount so a malformed URI surfaces a typed BadRequestException instead of a raw parse throw.
  private parseEvmPaymentRequest(uri: string, zchfAsset: Asset): { recipient: string; amountWei: BigNumber } {
    // path token contract: `ethereum:<tokenContract>@<chainId>/transfer?...`
    const uriTokenContract = uri.split('?')[0]?.split('@')[0]?.split(':')[1];
    if (!uriTokenContract || !Util.equalsIgnoreCase(uriTokenContract, zchfAsset.chainId)) {
      throw new BadRequestException('EVM payment request token contract does not match expected ZCHF asset');
    }

    const query = uri.split('?')[1];
    const params = new URLSearchParams(query);
    const recipient = params.get('address');
    const amount = params.get('uint256');
    if (!recipient || !amount) throw new BadRequestException('Invalid EVM payment request URI');

    try {
      if (!ethers.utils.isAddress(recipient)) throw new Error('invalid recipient address');
      const amountWei = BigNumber.from(amount);
      return { recipient, amountWei };
    } catch {
      throw new BadRequestException('Invalid EVM payment request recipient or amount');
    }
  }

  // --- Admin Methods ---

  private async getRealuQuote(
    requestId: number,
    relations: FindOptionsRelations<TransactionRequest> = {},
  ): Promise<TransactionRequest> {
    const request = await this.transactionRequestService.getTransactionRequest(requestId, relations);
    if (!request) throw new NotFoundException('Transaction request not found');

    // admin access is scoped to REALU buy/sell quotes
    if (request.type === TransactionRequestType.SWAP) throw new NotFoundException('Transaction request not found');

    const realuAsset = await this.getRealuAsset();
    const realuAssetId = request.type === TransactionRequestType.SELL ? request.sourceId : request.targetId;
    if (realuAssetId !== realuAsset.id) throw new NotFoundException('Transaction request not found');

    return request;
  }

  async confirmPaymentReceived(requestId: number): Promise<void> {
    const request = await this.getRealuQuote(requestId, { user: true });
    // getRealuQuote is a generic buy/sell-scoped helper; this endpoint
    // only confirms fiat payment on a buy quote. Reject sell quotes here: the DEV simulation path and the
    // PRD payAndAllocate path both assume buy-only state (routeId is a buy route; aktionariatResponse is
    // only written on buy). BadRequest, not NotFound — the quote already passed REALU scoping, so its
    // existence is disclosable.
    if (request.type !== TransactionRequestType.BUY) {
      throw new BadRequestException('Only buy quotes can be confirmed');
    }
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

  // --- AKTIONARIAT CONFIRMATION (public) --- //

  /**
   * Confirms an Aktionariat email connection from the public confirm-aktionariat endpoint. The
   * `code` is the authentication token; no api-key is sent. The Aktionariat response is mapped to
   * four states (confirmed / confirmed_no_registration / invalid / unavailable) and the outcome is
   * documented per registered wallet address.
   *
   * ASSUMPTION: the Aktionariat confirmation is keyed on the email and therefore applies to ALL
   * wallets that were RealUnit-registered under that email (the aktionariat_registration rows resolved by
   * email, both active and historical). The whole flow is logged, treating the email as personal data
   * (masked in logs).
   */
  async confirmAktionariat(
    dto: RealUnitConfirmAktionariatQueryDto,
    rawRequest: { url: string; query: Record<string, unknown> },
  ): Promise<RealUnitConfirmAktionariatDto> {
    const { email, code, user } = dto;
    const maskedEmail = this.maskEmail(email);

    this.logger.info(`Aktionariat confirmation requested (user: ${user}, email: ${maskedEmail})`);

    const walletAddresses = await this.getRegisteredWalletAddresses(email);
    if (walletAddresses.length) {
      this.logger.info(
        `Resolved ${walletAddresses.length} RealUnit wallet(s) for ${maskedEmail}: ${walletAddresses.join(', ')}`,
      );
    }

    const { httpStatus, responseBody, error } = await this.callAktionariatConfirm(email, code, user);
    const mappedStatus = this.mapConfirmationStatus(httpStatus);
    const noRegistrationMatch =
      !walletAddresses.length && mappedStatus === RealUnitAktionariatConfirmationStatus.CONFIRMED;
    const status = noRegistrationMatch ? RealUnitAktionariatConfirmationStatus.CONFIRMED_NO_REGISTRATION : mappedStatus;

    if (!walletAddresses.length) {
      const message = `No RealUnit registration wallet found for ${maskedEmail}`;
      if (noRegistrationMatch) {
        this.logger.error(message);
      } else {
        this.logger.warn(message);
      }
    }

    this.logger.info(
      `Aktionariat confirmation for ${maskedEmail} mapped to '${status}' (httpStatus: ${httpStatus ?? 'none'})`,
    );

    const confirmed = status === RealUnitAktionariatConfirmationStatus.CONFIRMED;
    // Severity of the DB audit row: a confirmed call is INFO, an invalid/expired link is a benign WARNING,
    // and every other outcome is an ERROR.
    const logSeverity =
      status === RealUnitAktionariatConfirmationStatus.CONFIRMED
        ? LogSeverity.INFO
        : status === RealUnitAktionariatConfirmationStatus.INVALID
          ? LogSeverity.WARNING
          : LogSeverity.ERROR;

    // Audit the WHOLE call exactly ONCE — BEFORE touching any registration and OUTSIDE any wallet loop — so a
    // 0-match call (email resolved to zero wallets) is still fully and durably recorded in the DB `log`, the
    // designated PII audit store. `response` is the successful body (undefined on error), `error` the full
    // error body (undefined on success). Best-effort: a logging failure must never fail the confirmation.
    await this.logAktionariatConfirmation(logSeverity, {
      email,
      code,
      user,
      walletAddresses,
      rawRequest,
      response: error == null ? responseBody : undefined,
      error,
    });

    // On a confirming (2xx) call, latch the first-confirmation date onto each resolved wallet's active
    // registration. The 2xx response must surface the PERSISTED first-confirmation date (the latch), never
    // this call's transient attempt time; keep the first persisted date we observe (all of an email's wallets
    // share this call).
    let confirmedDate: Date | undefined;
    if (confirmed) {
      const attemptDate = new Date();
      for (const walletAddress of walletAddresses) {
        const persistedDate = await this.applyRegistrationConfirmation(walletAddress, attemptDate);
        confirmedDate ??= persistedDate;
      }
    }

    return {
      status,
      confirmedAddresses: confirmed ? walletAddresses : [],
      confirmedDate: confirmed ? confirmedDate : undefined,
    };
  }

  private async getRegisteredWalletAddresses(email: string): Promise<string[]> {
    // Query the queryable registration table by email (the confirm link is keyed on the email), across
    // ALL wallets ever registered under it — active and historical rows alike. Return the exact signed
    // (checksummed, mixed-case) address from signedPayload so the confirm flow keeps its historical
    // casing; realunit_address_confirmation stays untouched. Fall back to the queryable lowercase column
    // only if a row has no signed payload.
    // De-duplicate case-insensitively (historical rows / mixed client casing can differ only in letter
    // case) while keeping the first-seen form — prefer the signed payload's casing over the lowercased
    // column so confirm rows stay stable.
    const registrations = await this.aktionariatRegistrationRepo.find({
      where: { email: Raw((alias) => `LOWER(${alias}) = :email`, { email: email.toLowerCase() }) },
      select: { id: true, signedPayload: true, walletAddress: true },
    });

    const addresses = new Map<string, string>();
    for (const registration of registrations) {
      const walletAddress = registration.signedPayloadData?.walletAddress ?? registration.walletAddress;
      if (!walletAddress) continue;
      const key = walletAddress.toLowerCase();
      if (!addresses.has(key)) addresses.set(key, walletAddress);
    }
    return Array.from(addresses.values());
  }

  private async callAktionariatConfirm(
    email: string,
    code: string,
    user: string,
  ): Promise<{ httpStatus?: number; responseBody: unknown; error?: unknown }> {
    // Deterministic mock: never reach the real Aktionariat API from a local/dev environment.
    if ([Environment.DEV, Environment.LOC].includes(Config.environment)) {
      this.logger.info('Aktionariat confirmation mocked (DEV/LOC environment)');
      return { httpStatus: 200, responseBody: { status: 200, message: 'DEV mock confirmation', mock: true } };
    }

    const baseUrl = Config.blockchain.realunit.aktionariatUrl;
    if (!baseUrl) {
      this.logger.error('Aktionariat URL is not configured');
      throw new Error('Aktionariat URL is not configured');
    }

    const endpoint = `${baseUrl}/confirmconnection`;
    const url = `${endpoint}?email=${encodeURIComponent(email)}&code=${encodeURIComponent(
      code,
    )}&user=${encodeURIComponent(user)}`;

    try {
      // Explicit timeout: without it a hung connection would never resolve to `unavailable`.
      const response = await this.http.getRaw<{ status: number; message: string }>(url, { timeout: 10000 }); // ms
      // The code is an auth secret carried in the query string; only the bare endpoint is logged.
      this.logger.info(`Aktionariat confirmation call to ${endpoint} returned status ${response.status}`);
      return { httpStatus: response.status, responseBody: response.data };
    } catch (error) {
      const httpStatus = error?.response?.status;
      const responseBody = error?.response?.data ?? error?.message ?? String(error);
      // Loki is the PII-free channel: log only the redacted status/type summary here (an Aktionariat error
      // body may echo the submitted email). The FULL body still reaches the DB `log` audit store, via the
      // returned raw error passed through describeError.
      const logMessage = `Aktionariat confirmation call to ${endpoint} failed (httpStatus: ${httpStatus ?? 'none'}): ${this.summarizeError(
        error,
      )}`;
      // A rejected confirm link (expired code, unknown email, ...) is the handled INVALID outcome of
      // mapConfirmationStatus — there is no API key on this call (the code is the credential), so a 4xx
      // cannot mean broken credentials. 429 is carved back out: throttling is a systemic fault. Anything
      // else (5xx, timeout, no status) is genuinely unavailable; both stay at error.
      const isRejectedLink =
        this.mapConfirmationStatus(httpStatus) === RealUnitAktionariatConfirmationStatus.INVALID && httpStatus !== 429;
      if (isRejectedLink) {
        this.logger.warn(logMessage);
      } else {
        this.logger.error(logMessage);
      }
      return { httpStatus, responseBody, error };
    }
  }

  private mapConfirmationStatus(httpStatus?: number): RealUnitAktionariatConfirmationStatus {
    // Fail-closed: anything that is not a clear 2xx (confirmed) or 4xx (invalid link) — including
    // 5xx, an unexpected status class, or a network/timeout error (no status) — is treated as
    // unavailable, i.e. an unknown confirmation state the client should retry, never a rejection.
    if (httpStatus == null) return RealUnitAktionariatConfirmationStatus.UNAVAILABLE;

    const statusClass = Math.floor(httpStatus / 100);
    if (statusClass === 2) return RealUnitAktionariatConfirmationStatus.CONFIRMED;
    if (statusClass === 4) return RealUnitAktionariatConfirmationStatus.INVALID;
    return RealUnitAktionariatConfirmationStatus.UNAVAILABLE;
  }

  // Latch the first-confirmation date onto a wallet's ACTIVE registration — the single source of truth for the
  // confirmed state (read back directly by resolveEmailConfirmation, no separate table, no join). Runs in a
  // short advisory-locked transaction (serialised per wallet cluster-wide, auto-released at txn end) so two
  // concurrent confirms for the same wallet cannot both write. Sets confirmedDate ONLY if still null
  // (first-wins latch: a later confirming call keeps the original date, never advances or clears it) and
  // returns the stored (first) confirmedDate. In prod a resolved wallet always has exactly one active
  // registration; if none matches this is a safe no-op — the call is still fully recorded in the DB `log`
  // audit written once per call above.
  private async applyRegistrationConfirmation(walletAddress: string, confirmedDate: Date): Promise<Date | undefined> {
    // The registration's queryable walletAddress column is canonically lowercased; match it exactly.
    const lowerAddress = walletAddress.toLowerCase();

    return this.aktionariatRegistrationRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
        'aktionariat_registration',
        lowerAddress,
      ]);

      const registration = await manager.findOne(AktionariatRegistration, {
        where: { walletAddress: lowerAddress, active: true },
      });
      if (!registration) {
        this.logger.warn(`No active RealUnit registration to confirm for wallet ${lowerAddress}`);
        return undefined;
      }

      // First-confirmation latch: set only on the FIRST confirmation, never advanced or regressed.
      if (registration.confirmedDate == null) {
        registration.confirmedDate = confirmedDate;
        await manager.save(registration);
      }

      // Return the PERSISTED latch so the caller's 2xx response reflects the stored first-confirmation date.
      return registration.confirmedDate;
    });
  }

  // Audit mirror of an Aktionariat confirm-connection call into the DB `log` table (the DESIGNATED PII audit
  // store, own access-control/retention — UNLIKE Loki, the PII-free channel of the this.logger.* lines).
  // Records the FULL communication (email, code, aktionariat user, resolved wallets, response, error body) as
  // ONE append-only row per CALL — fired once for the whole call, even a 0-match one, so no confirmation is
  // ever lost. Best-effort: a logging failure must never fail the confirmation, but it is surfaced loudly.
  private async logAktionariatConfirmation(
    severity: LogSeverity,
    data: {
      email: string;
      code: string;
      user: string;
      walletAddresses: string[];
      rawRequest: { url: string; query: Record<string, unknown> };
      response: unknown;
      error?: unknown;
    },
  ): Promise<void> {
    try {
      await this.logService.create({
        system: 'Aktionariat',
        subsystem: 'Confirmation',
        category: 'ServerCall',
        severity,
        message: JSON.stringify({
          action: 'confirmConnection',
          email: data.email,
          code: data.code,
          user: data.user,
          walletAddresses: data.walletAddresses,
          // The COMPLETE raw incoming confirm request: the full URL and EVERY query param (including any the DTO
          // does not model and thus strips, e.g. a wallet address / per-registration id the mail link may
          // carry). Captured verbatim so the per-address decision can be made from the audit data alone; the
          // typed email/code/user above stay the authoritative matching inputs. This is a PII field, hence the
          // DB `log` store (never the redacted Loki channel).
          rawRequest: data.rawRequest,
          response: data.response,
          error: this.describeError(data.error),
          // Uniqueness marker so LogService.create() never dedups two byte-identical consecutive audit rows
          // (e.g. an identical same-email re-confirm): EVERY confirm-flow call must produce its own row.
          loggedAt: new Date().toISOString(),
          logNonce: Util.randomString(8),
        }),
        valid: null,
      });
    } catch (e) {
      // Loki is PII-free: only the masked email reaches this.logger.error.
      this.logger.error(
        `Failed to write Aktionariat confirmation log for ${this.maskEmail(data.email)}: ${e?.message || e}`,
      );
    }
  }

  private maskEmail(email: string): string {
    const atIndex = email.indexOf('@');
    if (atIndex <= 0) return '***';
    return `${email.charAt(0)}***${email.substring(atIndex)}`;
  }

  // --- W2W TRANSFER --- //
  // User-initiated RealUnit wallet-to-wallet transfer. DFX pays gas via the gasless EIP-7702 relay,
  // but from a DEDICATED W2W gas-funding wallet (Config.blockchain.realunit.w2wGasWallet*) — never
  // the Sell/OTC relayer. See issue DFXswiss/api #684 (umbrella #666).

  async prepareTransfer(user: User, dto: RealUnitTransferDto): Promise<RealUnitTransferPaymentInfoDto> {
    const userData = user.userData;

    // 1. Registration required (async — must await; a bare Promise is always truthy)
    if (!(await this.hasRegistrationForWallet(userData, user.address))) {
      throw new RegistrationRequiredException(undefined, KycContext.REALUNIT_TRANSFER);
    }

    // 2. KYC Level check - Level 30 minimum
    if (userData.kycLevel < KycLevel.LEVEL_30) {
      throw new KycLevelRequiredException(
        KycLevel.LEVEL_30,
        userData.kycLevel,
        'KYC Level 30 required for RealUnit transfer',
        KycContext.REALUNIT_TRANSFER,
      );
    }

    // The W2W transfer is a pure on-chain REALU->REALU self-custody movement and is therefore
    // limit-exempt by design (consistent with #3819: trading limits are enforced at the fiat
    // boundary). Gate only on registration + KYC30; do NOT add a misleading limit check.

    // 3. Validate recipient + amount
    const [realuAsset, zchfAsset] = await Promise.all([this.getRealuAsset(), this.getZchfAsset()]);
    if (!realuAsset) throw new NotFoundException('REALU asset not found');

    if (!ethers.utils.isAddress(dto.toAddress)) {
      throw new BadRequestException('Invalid recipient address');
    }
    const toAddress = ethers.utils.getAddress(dto.toAddress);
    const sender = ethers.utils.getAddress(user.address);

    if (Util.equalsIgnoreCase(toAddress, sender)) {
      throw new BadRequestException('Recipient must differ from sender');
    }
    const forbiddenAddresses = [realuAsset.chainId, zchfAsset?.chainId].filter((a) => a);
    if (forbiddenAddresses.some((a) => Util.equalsIgnoreCase(a, toAddress))) {
      throw new BadRequestException('Recipient must not be a token contract address');
    }
    if (!Number.isInteger(dto.amount) || dto.amount < 1) {
      throw new BadRequestException('Amount must be a whole number of shares (>= 1)');
    }

    // 4. Preflight: dedicated W2W gas wallet must be configured and hold enough ETH for the relay
    await this.assertW2wGasWalletFunded();

    // 5. Prepare EIP-7702 delegation data the app must sign. The delegation's `delegate` MUST be the
    // dedicated W2W gas wallet (the redeemer at confirm), NOT the Sell/OTC relayer — the
    // DelegationManager enforces `msg.sender == delegate` in redeemDelegations, otherwise it reverts
    // InvalidDelegate(). Derive the delegate from the same key confirmTransfer relays with so they
    // always match.
    const w2wGasWalletAddress = this.getW2wGasWalletAddress();
    const delegationData = await this.eip7702DelegationService.prepareDelegationDataForRealUnit(
      sender,
      realuAsset.blockchain,
      w2wGasWalletAddress,
    );

    // 6. Persist the transfer intent server-side (the delegation is blanket — recipient/amount are
    // NOT bound by the signature, so they MUST be stored here and reused verbatim at confirm)
    const transferRequest = await this.transferRequestRepo.save(
      this.transferRequestRepo.create({
        uid: Util.createUid(Config.prefixes.realUnitTransferUidPrefix),
        user,
        toAddress,
        amount: dto.amount,
        status: RealUnitTransferRequestStatus.CREATED,
      }),
    );

    const amountWei = EvmUtil.toWeiAmount(dto.amount, realuAsset.decimals);

    return {
      id: transferRequest.id,
      uid: transferRequest.uid,
      toAddress,
      amount: dto.amount,
      tokenAddress: realuAsset.chainId,
      chainId: realuAsset.evmChainId,
      eip7702: {
        ...delegationData,
        tokenAddress: realuAsset.chainId,
        amountWei: amountWei.toString(),
        recipient: toAddress,
      },
    };
  }

  async confirmTransfer(
    userId: number,
    requestId: number,
    dto: RealUnitTransferConfirmDto,
  ): Promise<{ txHash: string }> {
    // 1. Load stored transfer request with ownership check (user is eager-loaded by the entity)
    const transferRequest = await this.transferRequestRepo.findOne({
      where: { id: requestId },
    });
    if (!transferRequest || transferRequest.user?.id !== userId) {
      throw new NotFoundException('Transfer request not found');
    }

    // 2. Idempotency shortcut — MUST run before any balance/gas/delegate checks: a prior attempt may
    // already have broadcast (txHash is persisted the instant the tx is signed, before it is sent to the
    // node — see Eip7702DelegationService._transferTokenWithUserDelegationInternal), and the sender's
    // on-chain balance is no longer guaranteed to cover `amount` again after a successful transfer.
    // FAILED requests are excluded so a reverted attempt's txHash is never handed back as a false success.
    if (transferRequest.txHash && transferRequest.status !== RealUnitTransferRequestStatus.FAILED) {
      return { txHash: transferRequest.txHash };
    }

    const realuAsset = await this.getRealuAsset();
    if (!realuAsset) throw new NotFoundException('REALU asset not found');

    // 3. Defense-in-depth: delegator must match the request owner's address (contract also verifies)
    if (!Util.equalsIgnoreCase(dto.delegation.delegator, transferRequest.user.address)) {
      throw new BadRequestException('Delegation delegator does not match user address');
    }

    // 4. Drain preflight: sender must hold enough REALU before we broadcast
    const balance = await this.getEvmClient().getTokenBalance(realuAsset, transferRequest.user.address);
    if (balance < transferRequest.amount) {
      throw new BadRequestException('Insufficient REALU balance for transfer');
    }

    // 5. Abort cleanly if the W2W gas wallet itself is underfunded
    await this.assertW2wGasWalletFunded();

    // 6. Defense-in-depth: delegate must be the W2W gas wallet that will redeem (msg.sender == delegate)
    const expectedDelegate = this.getW2wGasWalletAddress();
    if (!Util.equalsIgnoreCase(dto.delegation.delegate, expectedDelegate)) {
      throw new BadRequestException('Delegation delegate does not match the W2W gas wallet');
    }

    // 7. Dedicated W2W gas wallet pays gas — never the Sell/OTC relayer
    const relayerPrivateKey = this.getW2wGasWalletPrivateKey();

    // 8. Atomically claim the request (CREATED -> PROCESSING). This serializes concurrent/duplicate
    // confirm calls (double-tap, retry-after-timeout): a non-atomic read-then-write on `status` would let
    // a second caller pass the guard and relay the same blanket delegation twice.
    const res = await this.transferRequestRepo.update(
      { id: requestId, status: RealUnitTransferRequestStatus.CREATED },
      { status: RealUnitTransferRequestStatus.PROCESSING },
    );
    if (!res.affected) {
      throw new ConflictException('Transfer request is already in progress or completed');
    }

    // 9. Relay the STORED recipient + amount (never values from untrusted client input). Persist the
    // txHash the instant it is broadcast — before the receipt wait — so a timeout/crash after broadcast
    // never loses track of an already-broadcast transaction.
    let broadcastTxHash: string | undefined;
    let txHash: string;
    try {
      txHash = await this.eip7702DelegationService.transferTokenWithUserDelegation(
        transferRequest.user.address,
        realuAsset,
        transferRequest.toAddress,
        transferRequest.amount,
        dto.delegation,
        dto.authorization,
        relayerPrivateKey,
        async (hash) => {
          broadcastTxHash = hash;
          await this.transferRequestRepo.update(requestId, { txHash: hash });
        },
      );
    } catch (e) {
      if (e instanceof TransactionRevertedException) {
        // Broadcast succeeded but the tx reverted on-chain: mark FAILED even though txHash is set, so a
        // retry (which excludes FAILED from the idempotency shortcut above) never hands back the reverted
        // hash as a success — it re-enters the atomic claim, finds status=FAILED (not CREATED),
        // affected=0 -> ConflictException.
        await this.transferRequestRepo.update(requestId, { status: RealUnitTransferRequestStatus.FAILED });
      } else if (!broadcastTxHash) {
        // Broadcast never happened — nothing is in flight on-chain, safe to mark FAILED.
        await this.transferRequestRepo.update(requestId, { status: RealUnitTransferRequestStatus.FAILED });
      }
      // else: timeout/unknown error after a successful (non-reverted) broadcast — the tx may still mine.
      // Leave the request in PROCESSING (its txHash is already persisted); the reconciliation cron
      // (RealUnitService.reconcilePendingTransfers) resolves it on a later run.
      throw e;
    }

    this.logger.info(`RealUnit W2W transfer confirmed via EIP-7702: ${txHash}`);

    // 10. Mark request as complete
    await this.transferRequestRepo.save(transferRequest.complete(txHash));

    return { txHash };
  }

  /**
   * Resolves RealUnitTransferRequest rows stuck in PROCESSING because a crash/restart happened between
   * the atomic claim (CREATED -> PROCESSING) and the broadcast/callback in confirmTransfer. Called by
   * RealUnitJobService on a cron. Since the txHash is now persisted BEFORE the tx is sent to the node
   * (Eip7702DelegationService._transferTokenWithUserDelegationInternal), "PROCESSING without a txHash"
   * strictly means "never signed/broadcast" and is safe to mark FAILED once stale.
   */
  async reconcilePendingTransfers(): Promise<void> {
    const staleThreshold = Util.minutesBefore(5);
    const staleRequests = await this.transferRequestRepo.find({
      where: { status: RealUnitTransferRequestStatus.PROCESSING, updated: LessThan(staleThreshold) },
    });

    for (const request of staleRequests) {
      try {
        if (!request.txHash) {
          // Conditional update: only fail if still PROCESSING with no txHash. Concurrent onBroadcast
          // may have set txHash between our find and this write — then affected=0 and we skip.
          const res = await this.transferRequestRepo.update(
            { id: request.id, status: RealUnitTransferRequestStatus.PROCESSING, txHash: IsNull() },
            { status: RealUnitTransferRequestStatus.FAILED },
          );
          if (res.affected) {
            this.logger.info(`RealUnit W2W transfer request ${request.id} reconciled: no broadcast, marked FAILED`);
          }
          continue;
        }

        const receipt = await this.getEvmClient().getTxReceipt(request.txHash);
        if (!receipt) continue; // not yet mined / not found — leave PROCESSING for the next run

        if (receipt.status === 1) {
          const res = await this.transferRequestRepo.update(
            { id: request.id, status: RealUnitTransferRequestStatus.PROCESSING },
            { status: RealUnitTransferRequestStatus.COMPLETED, txHash: request.txHash },
          );
          if (res.affected) {
            this.logger.info(`RealUnit W2W transfer request ${request.id} reconciled: confirmed on-chain`);
          }
        } else {
          const res = await this.transferRequestRepo.update(
            { id: request.id, status: RealUnitTransferRequestStatus.PROCESSING },
            { status: RealUnitTransferRequestStatus.FAILED },
          );
          if (res.affected) {
            this.logger.info(
              `RealUnit W2W transfer request ${request.id} reconciled: reverted on-chain, marked FAILED`,
            );
          }
        }
      } catch (e) {
        this.logger.error(`Failed to reconcile RealUnit W2W transfer request ${request.id}:`, e);
      }
    }
  }

  private getW2wGasWalletPrivateKey(): `0x${string}` {
    const { w2wGasWalletPrivateKey } = Config.blockchain.realunit;
    if (!w2wGasWalletPrivateKey) {
      throw new ServiceUnavailableException('W2W gas funding temporarily unavailable');
    }
    return (
      w2wGasWalletPrivateKey.startsWith('0x') ? w2wGasWalletPrivateKey : `0x${w2wGasWalletPrivateKey}`
    ) as `0x${string}`;
  }

  // Address that confirmTransfer actually relays redeemDelegations with (msg.sender). Derived from the
  // SAME private key so the prepared delegation's `delegate` is guaranteed to match the redeemer and
  // the DelegationManager's `msg.sender == delegate` check passes (otherwise: InvalidDelegate revert).
  private getW2wGasWalletAddress(): string {
    const derivedAddress = new ethers.Wallet(this.getW2wGasWalletPrivateKey()).address;
    const { w2wGasWalletAddress } = Config.blockchain.realunit;
    if (w2wGasWalletAddress && !Util.equalsIgnoreCase(derivedAddress, w2wGasWalletAddress)) {
      throw new Error(
        'REALUNIT_W2W_GAS_WALLET_ADDRESS does not match the address derived from REALUNIT_W2W_GAS_WALLET_PRIVATE_KEY',
      );
    }
    return derivedAddress;
  }

  private async assertW2wGasWalletFunded(): Promise<void> {
    const { w2wGasWalletPrivateKey, w2wGasWalletAddress, w2wGasLowBalanceThreshold } = Config.blockchain.realunit;
    if (!w2wGasWalletPrivateKey || !w2wGasWalletAddress) {
      throw new ServiceUnavailableException('W2W gas funding temporarily unavailable');
    }

    const balance = await this.getEvmClient().getNativeCoinBalanceForAddress(w2wGasWalletAddress);
    if (balance < w2wGasLowBalanceThreshold) {
      // Clean message for the client; the balance observer raises the operator alert.
      throw new ServiceUnavailableException('W2W gas funding temporarily unavailable');
    }
  }
}
