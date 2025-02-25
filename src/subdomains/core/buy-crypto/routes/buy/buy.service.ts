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
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankSelectorInput, BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { TransactionRequestType } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { IsNull, Not, Repository } from 'typeorm';
import { Buy } from './buy.entity';
import { BuyRepository } from './buy.repository';
import { BankInfoDto, BuyPaymentInfoDto } from './dto/buy-payment-info.dto';
import { CreateBuyDto } from './dto/create-buy.dto';
import { GetBuyPaymentInfoDto } from './dto/get-buy-payment-info.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@Injectable()
export class BuyService {
  private readonly logger = new DfxLogger(BuyService);
  private cache: { id: number; bankUsage: string }[] = undefined;

  constructor(
    private readonly buyRepo: BuyRepository,
    private readonly userService: UserService,
    private readonly routeService: RouteService,
    private readonly paymentInfoService: PaymentInfoService,
    private readonly swissQrService: SwissQRService,
    private readonly bankService: BankService,
    private readonly transactionRequestService: TransactionRequestService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
    private readonly checkoutService: CheckoutService,
  ) {}

  // --- VOLUMES --- //
  @DfxCron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.buyRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(buyId: number, volume: number, annualVolume: number): Promise<void> {
    await this.buyRepo.update(buyId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.buyRepo.findOne({
      where: { id: buyId },
      relations: ['user'],
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateBuyVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
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
    return this.buyRepo.findOneBy({ id, user: { userData: { id: userDataId } } });
  }

  async createBuyPayment(jwt: JwtPayload, dto: GetBuyPaymentInfoDto): Promise<Buy> {
    dto = await this.paymentInfoService.buyCheck(dto, jwt);

    const buy = await Util.retry(
      () => this.createBuy(jwt.user, jwt.address, dto, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );

    return buy as Buy;
  }

  async createBuy(userId: number, userAddress: string, dto: CreateBuyDto, ignoreExisting = false): Promise<Buy> {
    // check if exists
    const existing = await this.buyRepo.findOne({
      where: {
        asset: { id: dto.asset.id },
        deposit: IsNull(),
        user: { id: userId },
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

    const user = await this.userService.getUser(userId, { userData: true });

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = user;
    buy.route = await this.routeService.createRoute({ buy });

    // create hash
    const hash = Util.createHash(userAddress + buy.asset.id + (buy.iban ?? '')).toUpperCase();
    buy.bankUsage = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;

    // save
    const entity = await this.buyRepo.save(buy);

    this.cache && this.cache.push({ id: entity.id, bankUsage: entity.bankUsage });

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
      where: { active: true, user: { userData: { id: userDataId } }, asset: { buyable: true } },
      relations: { user: true },
    });
  }

  async getByBankUsage(bankUsage: string): Promise<Buy> {
    return this.buyRepo.findOne({ where: { bankUsage }, relations: { user: { userData: true, wallet: true } } });
  }

  async getBuyByKey(key: string, value: any): Promise<Buy> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('buy')
      .leftJoinAndSelect('buy.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `buy.${key}`} = :param`, { param: value })
      .getOne();
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
    const user = await this.userService.getUser(userId, { userData: { users: true }, wallet: true });

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
      !dto.exactPrice,
      user,
    );

    const bankInfo = await this.getBankInfo({
      amount: amount,
      currency: dto.currency.name,
      paymentMethod: dto.paymentMethod,
      userData: user.userData,
    });

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
      // bank info
      ...bankInfo,
      sepaInstant: bankInfo.sepaInstant,
      remittanceInfo: buy.active ? buy.bankUsage : undefined,
      paymentRequest: isValid ? this.generateQRCode(buy, bankInfo, dto) : undefined,
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

  async getBankInfo(selector: BankSelectorInput): Promise<BankInfoDto> {
    const bank = await this.bankService.getBank(selector);

    if (!bank) throw new BadRequestException('No Bank for the given amount/currency');

    return { ...Config.bank.dfxBankInfo, bank: bank.name, iban: bank.iban, bic: bank.bic, sepaInstant: bank.sctInst };
  }

  private generateQRCode(buy: Buy, bankInfo: BankInfoDto, dto: GetBuyPaymentInfoDto): string {
    if (dto.currency.name === 'CHF') {
      return this.swissQrService.createQrCode(dto.amount, dto.currency.name, buy.bankUsage, bankInfo);
    } else {
      return this.generateGiroCode(buy, bankInfo, dto);
    }
  }

  private generateGiroCode(buy: Buy, bankInfo: BankInfoDto, dto: GetBuyPaymentInfoDto): string {
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
${buy.bankUsage}
`.trim();
  }
}
