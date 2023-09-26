import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Config } from 'src/config/config';
import { Lock } from 'src/shared/utils/lock';
import { Util } from 'src/shared/utils/util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';
import { IsNull, Not, Repository } from 'typeorm';
import { Buy } from './buy.entity';
import { BuyRepository } from './buy.repository';
import { CreateBuyDto } from './dto/create-buy.dto';
import { UpdateBuyDto } from './dto/update-buy.dto';

@Injectable()
export class BuyService {
  constructor(
    private readonly buyRepo: BuyRepository,
    private readonly userService: UserService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  @Lock()
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
  async get(userId: number, id: number): Promise<Buy> {
    return this.buyRepo.findOneBy({ id, user: { id: userId } });
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
      relations: ['deposit', 'bankAccount', 'user', 'user.userData'],
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

    // create the entity
    const buy = this.buyRepo.create(dto);
    buy.user = await this.userService.getUser(userId, ['userData']);
    if (dto.iban) buy.bankAccount = await this.bankAccountService.getOrCreateBankAccount(dto.iban, userId);

    // create hash
    const hash = Util.createHash(userAddress + buy.asset.uniqueName + (buy.iban ?? '')).toUpperCase();
    buy.bankUsage = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;

    // save
    return this.buyRepo.save(buy);
  }

  async getUserBuys(userId: number): Promise<Buy[]> {
    return this.buyRepo.findBy({ user: { id: userId }, asset: { buyable: true } });
  }

  async getByBankUsage(bankUsage: string): Promise<Buy> {
    return this.buyRepo.findOneBy({ bankUsage });
  }

  async getBuyByKey(key: string, value: any): Promise<Buy> {
    return this.buyRepo
      .createQueryBuilder('buy')
      .select('buy')
      .leftJoinAndSelect('buy.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`buy.${key} = :param`, { param: value })
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
