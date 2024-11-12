import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { DisabledProcess, Process } from 'src/shared/services/process.service';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { BankDataType } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { IsNull, Not, Repository } from 'typeorm';
import { Buy } from './buy.entity';
import { BuyRepository } from './buy.repository';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@Injectable()
export class BuyService {
  private readonly logger = new DfxLogger(BuyService);
  private cache: { id: number; bankUsage: string }[] = undefined;

  constructor(
    private readonly buyRepo: BuyRepository,
    private readonly userService: UserService,
    private readonly bankDataService: BankDataService,
    private readonly routeService: RouteService,
  ) {}

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  @Lock()
  async resetAnnualVolumes(): Promise<void> {
    await this.buyRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  @Lock(1800)
  async syncBuyBankData() {
    if (DisabledProcess(Process.BUY_BANK_ACCOUNT_SYNC)) return;

    const entities = await this.buyRepo.find({
      where: { bankAccount: { id: Not(IsNull()) }, bankData: { id: IsNull() } },
      relations: { bankAccount: { userData: true }, bankData: true },
    });

    for (const entity of entities) {
      try {
        const bankData = await this.bankDataService
          .getAllBankDatasForUser(entity.bankAccount.userData.id)
          .then((b) => b.find((b) => b.type === BankDataType.USER && b.iban === entity.bankAccount.iban));
        if (!bankData) continue;

        await this.buyRepo.update(entity.id, { bankData });
      } catch (e) {
        this.logger.error(`Error in buy bankAccount/bankData sync ${entity.id}`, e);
      }
    }
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

  async createBuy(userId: number, userAddress: string, dto: CreateBuyDto, ignoreExisting = false): Promise<Buy> {
    // check if exists
    const existing = await this.buyRepo.findOne({
      where: {
        ...(dto.iban ? { iban: dto.iban } : {}),
        asset: { id: dto.asset.id },
        deposit: IsNull(),
        user: { id: userId },
      },
      relations: { deposit: true, bankAccount: true, user: { userData: true } },
    });

    if (existing) {
      if (existing.active && !ignoreExisting) throw new ConflictException('Buy route already exists');

      if (!existing.active) {
        // reactivate deleted route
        existing.active = true;
        await this.buyRepo.save(existing);
      }

      // remove bank account info, if no IBAN was provided
      if (existing.bankAccount && !dto.iban) delete existing.bankAccount;

      return existing;
    }

    const user = await this.userService.getUser(userId, { userData: true });

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = user;
    buy.route = await this.routeService.createRoute({ buy });
    if (dto.iban)
      buy.bankData = await this.bankDataService.createIbanForUser(
        user.userData.id,
        { iban: dto.iban },
        true,
        BankDataType.USER,
      );

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
}
