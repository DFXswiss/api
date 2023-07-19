import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/create-sell.dto';
import { UpdateSellDto } from 'src/subdomains/core/sell-crypto/route/dto/update-sell.dto';
import { SellRepository } from 'src/subdomains/core/sell-crypto/route/sell.repository';
import { Sell } from './sell.entity';
import { DepositService } from '../../../supporting/address-pool/deposit/deposit.service';
import { User } from '../../../generic/user/models/user/user.entity';
import { Util } from 'src/shared/utils/util';
import { KycService } from 'src/subdomains/generic/user/models/kyc/kyc.service';
import { Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankAccountService } from '../../../supporting/bank/bank-account/bank-account.service';
import { Config } from 'src/config/config';
import { Lock } from 'src/shared/utils/lock';

@Injectable()
export class SellService {
  constructor(
    private readonly sellRepo: SellRepository,
    private readonly depositService: DepositService,
    private readonly kycService: KycService,
    private readonly userService: UserService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  // --- SELLS --- //
  async get(userId: number, id: number): Promise<Sell> {
    return this.sellRepo.findOneBy({ id, user: { id: userId } });
  }

  async getSellByKey(key: string, value: any): Promise<Sell> {
    return this.sellRepo
      .createQueryBuilder('sell')
      .select('sell')
      .leftJoinAndSelect('sell.deposit', 'deposit')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .leftJoinAndSelect('userData.users', 'users')
      .leftJoinAndSelect('users.wallet', 'wallet')
      .where(`sell.${key} = :param`, { param: value })
      .getOne();
  }

  async getUserSells(userId: number): Promise<Sell[]> {
    const sellRoutes = await this.sellRepo.findBy({ user: { id: userId } });
    return sellRoutes.filter((s) => s.fiat.buyable);
  }

  async createSell(userId: number, dto: CreateSellDto, ignoreExisting = false): Promise<Sell> {
    // check user data
    const dataComplete = await this.kycService.userDataComplete(userId);
    if (!dataComplete) throw new BadRequestException('Ident data incomplete');

    // check if exists
    const existing = await this.sellRepo.findOne({
      where: {
        iban: dto.iban,
        fiat: { id: dto.currency.id },
        deposit: { blockchain: dto.blockchain },
        user: { id: userId },
      },
      relations: ['deposit'],
    });

    if (existing) {
      if (existing.active && !ignoreExisting) throw new ConflictException('Sell route already exists');

      if (!existing.active) {
        // reactivate deleted route
        existing.active = true;
        await this.sellRepo.save(existing);
      }

      return existing;
    }

    // create the entity
    const sell = this.sellRepo.create(dto);
    sell.user = { id: userId } as User;
    sell.fiat = dto.currency;
    sell.deposit = await this.depositService.getNextDeposit(dto.blockchain);
    sell.bankAccount = await this.bankAccountService.getOrCreateBankAccount(dto.iban, userId);

    return this.sellRepo.save(sell);
  }

  async updateSell(userId: number, sellId: number, dto: UpdateSellDto): Promise<Sell> {
    const sell = await this.sellRepo.findOneBy({ id: sellId, user: { id: userId } });
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
}
