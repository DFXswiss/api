import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { CreateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/create-sell.dto';
import { UpdateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/update-sell.dto';
import { SellRepository } from 'src/subdomains/core/sell-crypto/route/sell.repository';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { PayInPurpose } from 'src/subdomains/supporting/payin/entities/crypto-input.entity';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionRequest } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { IsNull, Like, Not } from 'typeorm';
import { DepositService } from '../../../supporting/address-pool/deposit/deposit.service';
import { BankAccountService } from '../../../supporting/bank/bank-account/bank-account.service';
import { BuyFiatExtended } from '../../history/mappers/transaction-dto.mapper';
import { RouteService } from '../../route/route.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { BuyFiatService } from '../process/services/buy-fiat.service';
import { ConfirmDto } from './dto/confirm.dto';
import { Sell } from './sell.entity';

@Injectable()
export class SellService {
  private readonly logger = new DfxLogger(SellService);

  constructor(
    private readonly sellRepo: SellRepository,
    private readonly depositService: DepositService,
    private readonly userService: UserService,
    private readonly userDataService: UserDataService,
    private readonly bankAccountService: BankAccountService,
    private readonly assetService: AssetService,
    @Inject(forwardRef(() => PayInService))
    private readonly payInService: PayInService,
    @Inject(forwardRef(() => BuyFiatService))
    private readonly buyFiatService: BuyFiatService,
    private readonly transactionUtilService: TransactionUtilService,
    private readonly routeService: RouteService,
  ) {}

  // --- SELLS --- //
  async get(userId: number, id: number): Promise<Sell> {
    return this.sellRepo.findOne({ where: { id, user: { id: userId } }, relations: { user: true } });
  }

  async getById(id: number): Promise<Sell> {
    return this.sellRepo.findOne({ where: { id }, relations: { user: true } });
  }

  async getLatest(userId: number): Promise<Sell | null> {
    return this.sellRepo.findOne({
      where: { user: { id: userId } },
      relations: { user: true },
      order: { created: 'DESC' },
    });
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
    sell.bankAccount = await this.bankAccountService.getOrCreateBankAccount(dto.iban, userId);

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
  @Cron(CronExpression.EVERY_YEAR)
  @Lock()
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
      relations: ['user'],
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
}
