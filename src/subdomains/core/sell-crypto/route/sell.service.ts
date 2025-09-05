import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { merge } from 'lodash';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { CryptoService } from 'src/integration/blockchain/shared/services/crypto.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { AssetDtoMapper } from 'src/shared/models/asset/dto/asset-dto.mapper';
import { FiatDtoMapper } from 'src/shared/models/fiat/dto/fiat-dto.mapper';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DfxCron } from 'src/shared/utils/cron';
import { Util } from 'src/shared/utils/util';
import { CreateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/create-sell.dto';
import { UpdateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/update-sell.dto';
import { SellRepository } from 'src/subdomains/core/sell-crypto/route/sell.repository';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { CryptoPaymentMethod, FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  TransactionRequest,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { FindOneOptions, In, IsNull, Like, Not } from 'typeorm';
import { DepositService } from '../../../supporting/address-pool/deposit/deposit.service';
import { BuyFiatExtended } from '../../history/mappers/transaction-dto.mapper';
import { PaymentLink } from '../../payment-link/entities/payment-link.entity';
import { RouteService } from '../../route/route.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { BuyFiatService } from '../process/services/buy-fiat.service';
import { ConfirmDto } from './dto/confirm.dto';
import { GetSellPaymentInfoDto } from './dto/get-sell-payment-info.dto';
import { SellPaymentInfoDto } from './dto/sell-payment-info.dto';
import { Sell } from './sell.entity';

@Injectable()
export class SellService {
  private readonly logger = new DfxLogger(SellService);

  constructor(
    private readonly sellRepo: SellRepository,
    private readonly depositService: DepositService,
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly assetService: AssetService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    @Inject(forwardRef(() => TransactionUtilService))
    private readonly transactionUtilService: TransactionUtilService,
    private readonly routeService: RouteService,
    private readonly bankDataService: BankDataService,
    @Inject(forwardRef(() => TransactionHelper))
    private readonly transactionHelper: TransactionHelper,
    private readonly cryptoService: CryptoService,
    @Inject(forwardRef(() => TransactionRequestService))
    private readonly transactionRequestService: TransactionRequestService,
  ) {}

  // --- SELLS --- //
  async get(userId: number, id: number): Promise<Sell> {
    const sell = await this.sellRepo.findOne({
      where: { id, user: { id: userId } },
      relations: { user: { userData: true } },
    });
    if (!sell) throw new NotFoundException('Sell not found');
    return sell;
  }

  async getById(id: number, options?: FindOneOptions<Sell>): Promise<Sell> {
    const defaultOptions = { where: { id }, relations: { user: { userData: true } } };
    return this.sellRepo.findOne(merge(defaultOptions, options));
  }

  async getLatest(userId: number): Promise<Sell | null> {
    return this.sellRepo.findOne({
      where: { user: { id: userId } },
      relations: { user: { userData: true } },
      order: { created: 'DESC' },
    });
  }

  async getByLabel(userId: number, label: string, options?: FindOneOptions<Sell>): Promise<Sell> {
    const defaultOptions = {
      where: { route: { label }, user: { id: userId } },
      relations: { user: { userData: true } },
    };
    return this.sellRepo.findOne(merge(defaultOptions, options));
  }

  validateLightningRoute(route: Sell): void {
    if (!route) throw new NotFoundException('Sell route not found');
    if (route.deposit.blockchains !== Blockchain.LIGHTNING)
      throw new BadRequestException('Only Lightning routes are allowed');
  }

  async getPaymentRoute(idOrLabel: string, options?: FindOneOptions<Sell>): Promise<Sell> {
    const isRouteId = !isNaN(+idOrLabel);
    const sellRoute = isRouteId
      ? await this.getById(+idOrLabel, options)
      : await this.getByLabel(undefined, idOrLabel, options);

    try {
      this.validateLightningRoute(sellRoute);
    } catch (e) {
      this.logger.verbose(`Failed to validate sell route ${idOrLabel}:`, e);
      throw new NotFoundException(`Payment route not found`);
    }
    return sellRoute;
  }

  async getPaymentLinksFromRoute(
    routeIdOrLabel: string,
    externalIds?: string[],
    ids?: number[],
  ): Promise<PaymentLink[]> {
    const route = await this.getPaymentRoute(routeIdOrLabel, {
      relations: { paymentLinks: true },
      where: {
        paymentLinks: [
          ...(externalIds?.length ? [{ externalId: In(externalIds) }] : []),
          ...(ids?.length ? [{ id: In(ids) }] : []),
        ],
      },
      order: { paymentLinks: { created: 'ASC' } },
    });

    return Array.from(new Map((route.paymentLinks || []).map((l) => [l.id, l])).values());
  }

  async getSellByKey(key: string, value: any): Promise<Sell> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('sell')
      .leftJoinAndSelect('sell.deposit', 'deposit')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('userData.kycSteps', 'kycSteps')
      .leftJoinAndSelect('userData.country', 'country')
      .leftJoinAndSelect('userData.nationality', 'nationality')
      .leftJoinAndSelect('userData.organizationCountry', 'organizationCountry')
      .leftJoinAndSelect('userData.language', 'language')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`${key.includes('.') ? key : `sell.${key}`} = :param`, { param: value })
      .getOne();
  }

  async getUserSells(userId: number): Promise<Sell[]> {
    const sellableBlockchains = await this.assetService.getSellableBlockchains();

    const sells = await this.sellRepo.find({
      where: {
        user: { id: userId },
        fiat: { buyable: true },
        active: true,
      },
      relations: { deposit: true, user: true },
    });

    return sells.filter((s) => s.deposit.blockchainList.some((b) => sellableBlockchains.includes(b)));
  }

  async getSellWithoutRoute(): Promise<Sell[]> {
    return this.sellRepo.findBy({ route: { id: IsNull() } });
  }

  async createSellPaymentInfo(userId: number, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoDto> {
    const sell = await Util.retry(
      () => this.createSell(userId, { ...dto, blockchain: dto.asset.blockchain }, true),
      2,
      0,
      undefined,
      (e) => e.message?.includes('duplicate key'),
    );
    return this.toPaymentInfoDto(userId, sell, dto);
  }

  async createSell(userId: number, dto: CreateSellDto, ignoreException = false): Promise<Sell> {
    // check user data
    const userData = await this.userDataService.getUserDataByUser(userId);
    if (!userData.isDataComplete && !ignoreException) throw new BadRequestException('Ident data incomplete');

    // check if exists
    const existing = await this.sellRepo.findOne({
      where: {
        iban: dto.iban,
        fiat: { id: dto.currency.id },
        user: { id: userId },
        deposit: { blockchains: Like(`%${dto.blockchain}%`) },
      },
      relations: { deposit: true, user: true },
    });

    if (existing) {
      if (existing.active && !ignoreException) throw new ConflictException('Sell route already exists');

      if (!existing.active && userData.isDataComplete) {
        // reactivate deleted route
        existing.active = true;
        existing.bankData = await this.bankDataService.createIbanForUser(
          userData.id,
          { iban: dto.iban },
          true,
          BankDataType.USER,
        );
        await this.sellRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const sell = this.sellRepo.create(dto);
    sell.user = await this.userService.getUser(userId, { userData: true });
    sell.route = await this.routeService.createRoute({ sell });
    sell.fiat = dto.currency;
    sell.deposit = await this.depositService.getNextDeposit(dto.blockchain);
    sell.bankData = await this.bankDataService.createIbanForUser(
      userData.id,
      { iban: dto.iban },
      true,
      BankDataType.USER,
    );

    return this.sellRepo.save(sell);
  }

  async updateSell(userId: number, sellId: number, dto: UpdateSellDto): Promise<Sell> {
    const sell = await this.sellRepo.findOne({
      where: { id: sellId, user: { id: userId } },
      relations: { user: true },
    });
    if (!sell) throw new NotFoundException('Sell route not found');

    return this.sellRepo.save({ ...sell, ...dto });
  }

  async count(): Promise<number> {
    return this.sellRepo.count();
  }

  // --- VOLUMES --- //
  @DfxCron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    await this.sellRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  async updateVolume(sellId: number, volume: number, annualVolume: number): Promise<void> {
    await this.sellRepo.update(sellId, {
      volume: Util.round(volume, Config.defaultVolumeDecimal),
      annualVolume: Util.round(annualVolume, Config.defaultVolumeDecimal),
    });

    // update user volume
    const { user } = await this.sellRepo.findOne({
      where: { id: sellId },
      relations: { user: true },
      select: ['id', 'user'],
    });
    const userVolume = await this.getUserVolume(user.id);
    await this.userService.updateSellVolume(user.id, userVolume.volume, userVolume.annualVolume);
  }

  async getUserVolume(userId: number): Promise<{ volume: number; annualVolume: number }> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .addSelect('SUM(annualVolume)', 'annualVolume')
      .where('userId = :id', { id: userId })
      .getRawOne<{ volume: number; annualVolume: number }>();
  }

  async getTotalVolume(): Promise<number> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('SUM(volume)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  async getAllUserSells(userIds: number[]): Promise<Sell[]> {
    return this.sellRepo.find({
      where: { user: { id: In(userIds) } },
      relations: { user: true },
      order: { id: 'DESC' },
    });
  }

  // --- CONFIRMATION --- //
  async confirmSell(request: TransactionRequest, dto: ConfirmDto): Promise<BuyFiatExtended> {
    try {
      const route = await this.sellRepo.findOne({
        where: { id: request.routeId },
        relations: { deposit: true, user: { wallet: true, userData: true } },
      });

      const payIn = await this.transactionUtilService.handlePermitInput(route, request, dto);
      const buyFiat = await this.buyFiatService.createFromCryptoInput(payIn, route, request);

      await this.payInService.acknowledgePayIn(payIn.id, PayInPurpose.BUY_FIAT, route);

      return await this.buyFiatService.extendBuyFiat(buyFiat);
    } catch (e) {
      this.logger.warn(`Failed to execute permit transfer for sell request ${request.id}:`, e);
      throw new BadRequestException(`Failed to execute permit transfer: ${e.message}`);
    }
  }

  private async toPaymentInfoDto(userId: number, sell: Sell, dto: GetSellPaymentInfoDto): Promise<SellPaymentInfoDto> {
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
      dto.asset,
      dto.currency,
      CryptoPaymentMethod.CRYPTO,
      FiatPaymentMethod.BANK,
      dto.exactPrice,
      user,
      undefined,
      undefined,
      sell.iban.substring(0, 2),
    );

    const sellDto: SellPaymentInfoDto = {
      id: 0, // set during request creation
      timestamp,
      routeId: sell.id,
      fee: Util.round(feeSource.rate * 100, Config.defaultPercentageDecimal),
      depositAddress: sell.active ? sell.deposit.address : undefined,
      blockchain: dto.asset.blockchain,
      minDeposit: { amount: minVolume, asset: dto.asset.dexName },
      minVolume,
      minFee: feeSource.min,
      minVolumeTarget,
      minFeeTarget: feeTarget.min,
      fees: feeSource,
      exchangeRate,
      rate,
      exactPrice,
      priceSteps,
      estimatedAmount,
      amount,
      currency: FiatDtoMapper.toDto(dto.currency),
      beneficiary: { name: user.userData.verifiedName, iban: sell.iban },
      asset: AssetDtoMapper.toDto(dto.asset),
      maxVolume,
      maxVolumeTarget,
      feesTarget: feeTarget,
      paymentRequest: sell.active
        ? await this.cryptoService.getPaymentRequest(isValid, dto.asset, sell.deposit.address, amount)
        : undefined,
      isValid,
      error,
    };

    await this.transactionRequestService.create(TransactionRequestType.SELL, dto, sellDto, user.id);

    return sellDto;
  }

  async getPaymentRouteForPublicName(publicName: string): Promise<Sell | undefined> {
    return this.sellRepo.findOne({
      where: {
        active: true,
        deposit: { blockchains: Blockchain.LIGHTNING },
        user: { userData: { paymentLinksName: publicName } },
      },
      relations: { user: { userData: true } },
    });
  }

  async getPaymentRouteForKey(key: string): Promise<Sell | undefined> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .innerJoin('sell.deposit', 'deposit')
      .innerJoinAndSelect('sell.user', 'user')
      .innerJoinAndSelect('user.userData', 'userData')
      .where(
        `EXISTS (SELECT 1 FROM OPENJSON(userdata.paymentLinksConfig, '$.accessKeys') AS k WHERE k.value = :key )`,
        { key },
      )
      .andWhere('sell.active = 1')
      .andWhere('deposit.blockchains = :chain', { chain: Blockchain.LIGHTNING })
      .getOne();
  }
}
