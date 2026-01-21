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
import { Util } from 'src/shared/utils/util';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { UserStatus } from 'src/subdomains/generic/user/models/user/user.enum';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Wallet } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { BankSelectorInput, BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.entity';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
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
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';
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
      select: ['id', 'user'],
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
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .addSelect('SUM(monthlyVolume)', 'monthlyVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number; monthlyVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('SUM(volume)', 'volume')
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
    );

    const bankInfo = await this.getBankInfo(
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

    await this.transactionRequestService.create(TransactionRequestType.BUY, dto, buyDto, user.id);

    return buyDto;
  }

  async getBankInfo(
    selector: BankSelectorInput,
    buy?: Buy,
    asset?: Asset,
    wallet?: Wallet,
  ): Promise<BankInfoDto & { isPersonalIban: boolean; reference?: string }> {
    // asset-specific personal IBAN
    if (
      buy &&
      asset?.personalIbanEnabled &&
      wallet?.buySpecificIbanEnabled &&
      selector.userData.kycLevel >= KycLevel.LEVEL_50
    ) {
      let virtualIban = await this.virtualIbanService.getActiveForBuyAndCurrency(buy.id, selector.currency);

      if (!virtualIban) {
        // max 10 vIBANs per user
        const activeCount = await this.virtualIbanService.countActiveForUser(selector.userData.id);
        if (activeCount < 10) {
          virtualIban = await this.virtualIbanService.createForBuy(selector.userData, buy, selector.currency);
        }
      }

      if (virtualIban) {
        return this.buildVirtualIbanResponse(virtualIban, selector.userData);
      }
    }

    // user-level vIBAN
    let virtualIban = await this.virtualIbanService.getActiveForUserAndCurrency(selector.userData, selector.currency);

    // EUR/CHF: create vIBAN for KYC 50+
    if (!virtualIban && ['EUR', 'CHF'].includes(selector.currency) && selector.userData.kycLevel >= KycLevel.LEVEL_50) {
      virtualIban = await this.virtualIbanService.createForUser(selector.userData, selector.currency);
    }

    if (virtualIban) {
      return this.buildVirtualIbanResponse(virtualIban, selector.userData, buy?.bankUsage);
    }

    // EUR: vIBAN is mandatory
    if (selector.currency === 'EUR') {
      throw new BadRequestException('KycRequired');
    }

    // normal bank selection
    const bank = await this.bankService.getBank(selector);

    if (!bank) throw new BadRequestException('No Bank for the given amount/currency');

    return {
      ...Config.bank.dfxAddress,
      bank: bank.name,
      iban: bank.iban,
      bic: bank.bic,
      sepaInstant: bank.sctInst,
      isPersonalIban: false,
      reference: buy?.bankUsage,
    };
  }

  private buildVirtualIbanResponse(
    virtualIban: VirtualIban,
    userData: UserData,
    reference?: string,
  ): BankInfoDto & { isPersonalIban: boolean; reference?: string } {
    const { address } = userData;
    return {
      name: userData.completeName,
      street: address.street,
      ...(address.houseNumber && { number: address.houseNumber }),
      zip: address.zip,
      city: address.city,
      country: address.country?.name,
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
    const reference = bankInfo.reference ?? '';

    return `
${Config.giroCode.service}
${Config.giroCode.version}
${Config.giroCode.encoding}
${Config.giroCode.transfer}
${bankInfo.bic}
${bankInfo.name}, ${bankInfo.street} ${bankInfo.number}, ${bankInfo.zip} ${bankInfo.city}, ${bankInfo.country}
${bankInfo.iban}
${dto.currency.name}${dto.amount}
${Config.giroCode.char}
${Config.giroCode.ref}
${reference}
`.trim();
  }
}
