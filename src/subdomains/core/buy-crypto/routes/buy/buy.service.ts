import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { DfxCron } from 'src/shared/utils/cron';
import { PdfUtil } from 'src/shared/utils/pdf.util';
import { Util } from 'src/shared/utils/util';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { BankSelectorInput, BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VibanAccountHolder } from 'src/subdomains/supporting/bank/virtual-iban/providers/viban-account-holder.enum';
import { VirtualIban, VirtualIbanStatus } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Buy } from './buy.entity';
import { BuyRepository } from './buy.repository';
import { BankInfoDto, BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { GetBuyPaymentInfoDto, PersonalIbanProvider } from './dto/get-buy-payment-info.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@Injectable()
export class BuyService {
  private cache: { id: number; bankUsage: string }[] = undefined;

  constructor(
    private readonly buyRepo: BuyRepository,
    private readonly userService: UserService,
    private readonly routeService: RouteService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly swissQrService: SwissQRService,
    private readonly bankService: BankService,
    @Inject(forwardRef(() => TransactionRequestService))
    private readonly transactionRequestService: TransactionRequestService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
    private readonly checkoutService: CheckoutService,
    private readonly virtualIbanService: VirtualIbanService,
  ) {}

  // --- VOLUMES --- //
  @DfxCron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.buyRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  @DfxCron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async resetMonthlyVolumes(): Promise<void> {
    await this.buyRepo.update({ monthlyVolume: Not(0) }, { monthlyVolume: 0 });
  }

  async updateVolume(buyId: number, volume: number, annualVolume: number, monthlyVolume: number): Promise<void> {
    await this.buyRepo.update(buyId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
      monthlyVolume: Util.round(monthlyVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.buyRepo.findOne({
      where: { id: buyId },
      relations: { user: true },
      select: { id: true, user: true },
    });
    const userVolume = await this.getUserVolume(user.id);

    await this.userService.updateBuyVolume(
      user.id,
      userVolume.volume,
      userVolume.annualVolume,
      userVolume.monthlyVolume,
    );
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number; monthlyVolume: number }> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('SUM(buy.volume)', 'volume')
      .addSelect('SUM(buy.annualVolume)', 'annualVolume')
      .addSelect('SUM(buy.monthlyVolume)', 'monthlyVolume')
      .where('buy.userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number; monthlyVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('SUM(buy.volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  // --- BUYS --- //
  async getAllBankUsages(): Promise<{ id: number; bankUsage: string }[]> {
    if (!this.cache)
      this.cache = await this.buyRepo.find().then((b) =>
        b.map((b) => ({
          id: b.id,
          bankUsage: b.bankUsage,
        })),
      );

    return this.cache;
  }

  async get(userDataId: number, id: number): Promise<Buy> {
    const buy = await this.buyRepo.findOne({
      where: { id, user: { userData: { id: userDataId } } },
      relations: { user: true },
    });
    if (!buy) throw new NotFoundException('Buy not found');
    return buy;
  }

  async getById(id: number): Promise<Buy> {
    return this.buyRepo.findOne({ where: { id } });
  }

  async createBuyPaymentInfo(jwt: JwtPayload, dto: GetBuyPaymentInfoDto): Promise<BuyPaymentInfoDto> {
    const user = await this.userService.getUser(jwt.user, { userData: { wallet: true } });
    if (dto.personalIbanProvider === PersonalIbanProvider.FRICK && dto.paymentMethod !== FiatPaymentMethod.BANK) {
      throw new BadRequestException(QuoteError.PAYMENT_METHOD_NOT_ALLOWED);
    }
    dto = await this.paymentInfoService.buyCheck(dto, jwt, user);
    const buy = await Util.retry(
      () => this.createBuy(user, jwt.address, dto, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );

    return this.toPaymentInfoDto(jwt.user, buy, dto);
  }

  async createBuy(user: User, userAddress: string, dto: CreateBuyDto, ignoreExisting = false): Promise<Buy> {
    // check if exists
    const existing = await this.buyRepo.findOne({
      where: {
        asset: { id: dto.asset.id },
        deposit: IsNull(),
        user: { id: user.id },
      },
      relations: { deposit: true, user: { userData: true } },
    });

    if (existing) {
      if (existing.active && !ignoreExisting) throw new ConflictException('Buy route already exists');

      if (!existing.active) {
        // reactivate deleted route
        existing.active = true;
        await this.buyRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = user;
    buy.route = await this.routeService.createRoute({ buy });

    // create hash
    const hash = Util.createHash(userAddress + buy.asset.id + (buy.iban ?? '')).toUpperCase();
    buy.bankUsage = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;

    // save
    const entity = await this.buyRepo.save(buy);

    if (this.cache) this.cache.push({ id: entity.id, bankUsage: entity.bankUsage });

    return entity;
  }

  async getBuyWithoutRoute(): Promise<Buy[]> {
    return this.buyRepo.findBy({ route: { id: IsNull() } });
  }

  async getUserBuys(userId: number): Promise<Buy[]> {
    return this.buyRepo.findBy({ user: { id: userId }, asset: { buyable: true }, active: true });
  }

  async getUserDataBuys(userDataId: number): Promise<Buy[]> {
    return this.buyRepo.find({
      where: {
        active: true,
        user: { userData: { id: userDataId }, status: Not(In([UserStatus.BLOCKED, UserStatus.DELETED])) },
        asset: { buyable: true },
      },
      relations: { user: true },
    });
  }

  async getByBankUsage(bankUsage: string): Promise<Buy> {
    return this.buyRepo.findOne({ where: { bankUsage }, relations: { user: { userData: true, wallet: true } } });
  }

  async getBuyByKey(key: string, value: any, onlyDefaultRelation = false): Promise<Buy> {
    const query = this.buyRepo
      .createQueryBuilder('buy')
      .select('buy')
      .leftJoinAndSelect('buy.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where(`${key.includes('.') ? key : `buy.${key}`} = :param`, { param: value });

    if (!onlyDefaultRelation) {
      query.leftJoinAndSelect('buy.deposit', 'deposit');
      query.leftJoinAndSelect('userData.users', 'users');
      query.leftJoinAndSelect('userData.kycSteps', 'kycSteps');
      query.leftJoinAndSelect('userData.country', 'country');
      query.leftJoinAndSelect('userData.nationality', 'nationality');
      query.leftJoinAndSelect('userData.organizationCountry', 'organizationCountry');
      query.leftJoinAndSelect('userData.verifiedCountry', 'verifiedCountry');
      query.leftJoinAndSelect('userData.language', 'language');
      query.leftJoinAndSelect('users.wallet', 'wallet');
    }

    return query.getOne();
  }

  async getAllUserBuys(userIds: number[]): Promise<Buy[]> {
    return this.buyRepo.find({
      where: { user: { id: In(userIds) } },
      relations: { user: true },
      order: { id: 'DESC' },
    });
  }

  async updateBuy(userId: number, buyId: number, dto: UpdateBuyDto): Promise<Buy> {
    const buy = await this.buyRepo.findOneBy({ id: buyId, user: { id: userId } });
    if (!buy) throw new NotFoundException('Buy route not found');

    return this.buyRepo.save({ ...buy, ...dto });
  }

  //*** GETTERS ***//

  getBuyRepo(): Repository<Buy> {
    return this.buyRepo;
  }

  async toPaymentInfoDto(userId: number, buy: Buy, dto: GetBuyPaymentInfoDto): Promise<BuyPaymentInfoDto> {
    const user = await this.userService.getUser(userId, {
      userData: { users: true, organization: true },
      wallet: true,
    });

    // Explicit personal-IBAN selector dispatch is exhaustive and fail-closed. Frick resolves the
    // deposit destination before fee calculation so bankInOverride can pass the Frick bank name
    // (Frick is excluded from getBankIn()'s user-level pool).
    //
    // Every other path: merge-base order — getTxDetails first (bankInOverride undefined so getBankIn()
    // resolves fees itself), then resolveBankInfo with the amount from getTxDetails. That way a failed
    // quote never creates an external account (createForUser / createForBuy) for non-selector customers.
    // Assigned exactly once: FRICK path before getTxDetails, all other paths after.
    let resolvedBank!: {
      bankInfo: BankInfoDto & { isPersonalIban: boolean; reference?: string };
      bankId: number;
      virtualIbanId?: number;
      bankName: IbanBankName;
    };
    let bankInOverride: IbanBankName | undefined;

    switch (dto.personalIbanProvider) {
      case undefined:
        break;
      case PersonalIbanProvider.FRICK:
        resolvedBank = await this.resolveBankInfo(
          {
            amount: dto.amount,
            currency: dto.currency.name,
            paymentMethod: dto.paymentMethod,
            userData: user.userData,
          },
          buy,
          dto.asset,
          user.wallet,
          dto.personalIbanProvider,
        );
        bankInOverride = resolvedBank.bankName;
        break;
      default:
        throw new BadRequestException(QuoteError.PERSONAL_IBAN_PROVIDER_UNSUPPORTED);
    }

    const {
      timestamp,
      minVolume,
      minVolumeTarget,
      maxVolume,
      maxVolumeTarget,
      exchangeRate,
      rate,
      estimatedAmount,
      sourceAmount: amount,
      isValid,
      error,
      exactPrice,
      feeSource,
      feeTarget,
      priceSteps,
    } = await this.transactionHelper.getTxDetails(
      dto.amount,
      dto.targetAmount,
      dto.currency,
      dto.asset,
      dto.paymentMethod,
      CryptoPaymentMethod.CRYPTO,
      dto.exactPrice,
      user,
      undefined,
      [],
      undefined,
      undefined,
      bankInOverride,
    );

    if (dto.personalIbanProvider === undefined) {
      resolvedBank = await this.resolveBankInfo(
        {
          amount: amount,
          currency: dto.currency.name,
          paymentMethod: dto.paymentMethod,
          userData: user.userData,
        },
        buy,
        dto.asset,
        user.wallet,
      );
    }

    const bankInfo = resolvedBank.bankInfo;

    const buyDto: BuyPaymentInfoDto = {
      id: 0, // set during request creation
      timestamp,
      routeId: buy.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      minDeposit: { amount: minVolume, asset: dto.currency.name }, // TODO: remove
      minVolume,
      minFee: feeSource.min,
      minVolumeTarget,
      minFeeTarget: feeTarget.min,
      fees: feeSource,
      feesTarget: feeTarget,
      exchangeRate,
      rate,
      exactPrice,
      priceSteps,
      estimatedAmount,
      amount,
      asset: AssetDtoMapper.toDto(dto.asset),
      currency: FiatDtoMapper.toDto(dto.currency),
      maxVolume,
      maxVolumeTarget,
      isValid,
      error,
      isPersonalIban: bankInfo.isPersonalIban,
      // bank info
      ...bankInfo,
      sepaInstant: bankInfo.sepaInstant,
      remittanceInfo: buy.active ? bankInfo.reference : undefined,
      paymentRequest: isValid ? this.generateQRCode(bankInfo, dto, user.userData) : undefined,
      // card info
      paymentLink:
        isValid && buy.active && dto.paymentMethod === FiatPaymentMethod.CARD
          ? await this.checkoutService.createPaymentLink(
              buy.bankUsage,
              amount,
              dto.currency,
              dto.asset,
              user.userData.language,
            )
          : undefined,
    };

    const bankSelection =
      dto.personalIbanProvider === PersonalIbanProvider.FRICK
        ? { bankId: resolvedBank.bankId, virtualIbanId: resolvedBank.virtualIbanId }
        : undefined;
    await this.transactionRequestService.create(TransactionRequestType.BUY, dto, buyDto, user.id, bankSelection);

    return buyDto;
  }

  async getBankInfo(
    selector: BankSelectorInput,
    buy?: Buy,
    asset?: Asset,
    wallet?: Wallet,
  ): Promise<BankInfoDto & { isPersonalIban: boolean; reference?: string }> {
    return this.resolveBankInfo(selector, buy, asset, wallet).then((resolved) => resolved.bankInfo);
  }

  /**
   * Rebuilds invoice bank data from the exact IDs persisted with a new transaction request.
   * Dynamic legacy selection is permitted only when both IDs are absent.
   *
   * @param requireLiveVirtualIban When true (still-open / unpaid quote), also verify that the
   * stored personal IBAN is active and the bank still accepts payments. When false (historical
   * completed lookup / receipt), skip liveness and serve the stored data as-is.
   */
  async getBankInfoForRequest(
    selector: BankSelectorInput,
    buy: Buy,
    requireLiveVirtualIban: boolean,
    bankId?: number,
    virtualIbanId?: number,
    asset?: Asset,
    wallet?: Wallet,
  ): Promise<BankInfoDto & { isPersonalIban: boolean; reference?: string }> {
    if (bankId == null && virtualIbanId == null) return this.getBankInfo(selector, buy, asset, wallet);
    if (bankId == null) throw new BadRequestException(QuoteError.STORED_TRANSACTION_REQUEST_BANK_SELECTION_INCOMPLETE);

    // Stored request liveness is a correctness boundary: receive/IBAN changes made by Operations
    // must be visible immediately, so this deliberately reads through to the DB.
    const bank = await this.bankService.getBankByIdUncached(bankId);
    if (!bank) throw new BadRequestException(QuoteError.STORED_TRANSACTION_REQUEST_BANK_NO_LONGER_EXISTS);

    if (virtualIbanId != null) {
      const virtualIban = await this.virtualIbanService.getByIdForUser(virtualIbanId, selector.userData.id);
      if (!virtualIban) throw new BadRequestException(QuoteError.STORED_PERSONAL_IBAN_USER_MISMATCH);
      if (
        virtualIban.bank.id !== bankId ||
        virtualIban.currency.name !== selector.currency ||
        (virtualIban.buy && virtualIban.buy.id !== buy.id)
      )
        throw new BadRequestException(QuoteError.STORED_PERSONAL_IBAN_TRANSACTION_REQUEST_MISMATCH);

      if (requireLiveVirtualIban) {
        if (!virtualIban.active || virtualIban.status !== VirtualIbanStatus.ACTIVE)
          throw new BadRequestException(QuoteError.STORED_PERSONAL_IBAN_IS_NO_LONGER_ACTIVE);
        if (!bank.receive) throw new BadRequestException(QuoteError.STORED_BANK_NO_LONGER_ACCEPTS_PAYMENTS);
      }

      return this.buildVirtualIbanResponse(virtualIban, selector.userData, virtualIban.buy ? undefined : buy.bankUsage);
    }

    if (requireLiveVirtualIban && !bank.receive)
      throw new BadRequestException(QuoteError.STORED_BANK_NO_LONGER_ACCEPTS_PAYMENTS);

    return this.buildBankResponse(bank, buy.bankUsage);
  }

  private async resolveBankInfo(
    selector: BankSelectorInput,
    buy?: Buy,
    asset?: Asset,
    wallet?: Wallet,
    personalIbanProvider?: PersonalIbanProvider,
  ): Promise<{
    bankInfo: BankInfoDto & { isPersonalIban: boolean; reference?: string };
    bankId: number;
    virtualIbanId?: number;
    bankName: IbanBankName;
  }> {
    if (personalIbanProvider === PersonalIbanProvider.FRICK) {
      if (selector.currency !== 'EUR') throw new BadRequestException(QuoteError.PERSONAL_IBAN_CURRENCY_NOT_SUPPORTED);
      if (selector.paymentMethod !== FiatPaymentMethod.BANK)
        throw new BadRequestException(QuoteError.PAYMENT_METHOD_NOT_ALLOWED);

      const virtualIban = await this.virtualIbanService.getOrCreateFrickForUser(selector.userData, selector.currency);
      if (!virtualIban.bank.receive || virtualIban.bank.name !== IbanBankName.FRICK)
        throw new BadRequestException(QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED);

      return {
        bankInfo: this.buildVirtualIbanResponse(virtualIban, selector.userData, buy?.bankUsage),
        bankId: virtualIban.bank.id,
        virtualIbanId: virtualIban.id,
        bankName: virtualIban.bank.name,
      };
    }

    // CARD keeps the same active-vIBAN lookups as BANK so an existing personal IBAN remains visible,
    // but it must never issue a new one because card payments use a payment link instead of a deposit IBAN.
    // asset-specific personal IBAN. Deliberately not for EUR: buy-specific issuance runs through the
    // generic createForBuy path, which has none of the advisory-lock, merged-account and claim-recovery
    // handling that Bank Frick issuance needs (getOrCreateFrickForUser). An EUR request falls through
    // to the user-level step below, which does go through that machinery. Lift this only together with
    // a buy-specific equivalent of it - the flags gating this branch are off in production today, so
    // nothing silently depends on the unsafe path.
    if (
      buy &&
      selector.currency !== 'EUR' &&
      asset?.personalIbanEnabled &&
      wallet?.buySpecificIbanEnabled &&
      selector.userData.kycLevel >= KycLevel.LEVEL_50
    ) {
      let virtualIban = await this.virtualIbanService.getActiveForBuyAndCurrency(buy.id, selector.currency);

      if (!virtualIban && selector.paymentMethod !== FiatPaymentMethod.CARD) {
        // max 10 vIBANs per user
        const activeCount = await this.virtualIbanService.countActiveForUser(selector.userData.id);
        if (activeCount < 10) {
          virtualIban = await this.virtualIbanService
            .createForBuy(selector.userData, buy, selector.currency)
            .catch(() => null);
        }
      }

      if (virtualIban?.bank.receive) {
        return {
          bankInfo: this.buildVirtualIbanResponse(virtualIban, selector.userData),
          bankId: virtualIban.bank.id,
          virtualIbanId: virtualIban.id,
          bankName: virtualIban.bank.name,
        };
      }
    }

    // user-level vIBAN
    let virtualIban = await this.virtualIbanService.getActiveReceivingForUserAndCurrency(
      selector.userData,
      selector.currency,
    );

    // create a personal IBAN for an eligible KYC 50+ user
    if (
      !virtualIban &&
      selector.paymentMethod !== FiatPaymentMethod.CARD &&
      this.virtualIbanService.isUserEligible(selector.currency, selector.userData)
    ) {
      // EUR goes through the Frick-specific issuance (advisory lock, merged accounts, claim recovery);
      // every other currency keeps the generic provider path. Both swallow a failure the same way, so a
      // transient issuance error degrades identically instead of breaking one currency harder than the
      // other - the distinction between "not eligible" and "issuance failed" is made below.
      virtualIban = await (
        selector.currency === 'EUR'
          ? this.virtualIbanService.getOrCreateFrickForUser(selector.userData, selector.currency)
          : this.virtualIbanService.createForUser(selector.userData, selector.currency)
      ).catch(() => null);
    }

    if (virtualIban?.bank.receive) {
      return {
        bankInfo: this.buildVirtualIbanResponse(virtualIban, selector.userData, buy?.bankUsage),
        bankId: virtualIban.bank.id,
        virtualIbanId: virtualIban.id,
        bankName: virtualIban.bank.name,
      };
    }

    // No personal IBAN could be resolved, and a collection account must never be shown - so a transfer
    // fails here instead of falling back to one. This applies to EVERY currency, not just EUR: it is
    // the deliberate policy that a bank transfer requires a personal IBAN, and therefore KYC 50.
    // Card payments use no deposit IBAN at all (the response carries a payment link), so they keep
    // resolving a bank rather than breaking.
    //
    // Three reasons are told apart, because sending a customer after the wrong one wastes their time:
    // no provider covers the currency at all; the customer has not reached KYC 50; or issuance failed
    // for someone who has. KYC is read directly rather than through isUserEligible, which also folds
    // in whether the provider is reachable right now - during an outage that would tell a fully
    // verified customer to complete a level they already hold.
    if (selector.paymentMethod !== FiatPaymentMethod.CARD)
      throw new BadRequestException(
        !this.virtualIbanService.hasProviderSupportingCurrency(selector.currency)
          ? QuoteError.PERSONAL_IBAN_CURRENCY_NOT_SUPPORTED
          : selector.userData.kycLevel >= KycLevel.LEVEL_50
            ? QuoteError.PERSONAL_IBAN_ISSUANCE_FAILED
            : QuoteError.KYC_REQUIRED,
      );

    const bank = await this.bankService.getBank(selector);

    if (!bank) throw new BadRequestException('No Bank for the given amount/currency');

    return {
      bankInfo: this.buildBankResponse(bank, buy?.bankUsage),
      bankId: bank.id,
      bankName: bank.name,
    };
  }

  // getBank() can return undefined, but this builder dereferences the bank unconditionally - callers
  // must resolve that before calling in, so the parameter states the precondition instead of widening.
  private buildBankResponse(
    bank: NonNullable<Awaited<ReturnType<BankService['getBank']>>>,
    reference?: string,
  ): BankInfoDto & { isPersonalIban: boolean; reference?: string } {
    return {
      ...Config.bank.dfxAddress,
      bank: bank.name,
      iban: bank.iban,
      bic: bank.bic,
      sepaInstant: bank.sctInst,
      isPersonalIban: false,
      reference,
    };
  }

  private buildVirtualIbanResponse(
    virtualIban: VirtualIban,
    userData: UserData,
    reference?: string,
  ): BankInfoDto & { isPersonalIban: boolean; reference?: string } {
    // Bank Frick issues the personal IBAN as a routing sub-account of DFX's own account, not an account
    // opened in the customer's name (see FrickCreateVirtualIbanRequest — the create request never sends
    // name/address). Yapeal genuinely opens the account in the customer's own name. Showing the wrong
    // holder as recipient makes the payer's bank flag/reject the SEPA name<->IBAN match, defeating the
    // point of a "verified" personal IBAN. VirtualIbanService.getAccountHolder is the single source of
    // truth for which case applies (see its doc comment for why the lookup lives there, not on this
    // entity: this function only has the persisted row, never the issuing provider instance).
    const accountHolder = this.virtualIbanService.getAccountHolder(virtualIban.bank.name);
    const { address } = userData;
    const recipient =
      accountHolder === VibanAccountHolder.CUSTOMER
        ? {
            name: userData.completeName,
            street: address.street,
            ...(address.houseNumber && { number: address.houseNumber }),
            zip: address.zip,
            city: address.city,
            country: address.country?.name,
          }
        : { ...Config.bank.dfxAddress };

    return {
      ...recipient,
      bank: virtualIban.bank.name,
      iban: virtualIban.iban,
      bic: virtualIban.bank.bic,
      sepaInstant: virtualIban.bank.sctInst,
      isPersonalIban: true,
      reference,
    };
  }

  private generateQRCode(
    bankInfo: BankInfoDto & { reference?: string },
    dto: GetBuyPaymentInfoDto,
    userData: UserData,
  ): string {
    if (dto.currency.name === 'CHF') {
      return this.swissQrService.createQrCode(dto.amount, dto.currency.name, bankInfo.reference, bankInfo, userData);
    } else {
      return this.generateGiroCode(bankInfo, dto);
    }
  }

  private generateGiroCode(bankInfo: BankInfoDto & { reference?: string }, dto: GetBuyPaymentInfoDto): string {
    return PdfUtil.generateGiroCode({
      ...bankInfo,
      currency: dto.currency.name,
      amount: dto.amount,
      reference: bankInfo.reference,
    });
  }
}
