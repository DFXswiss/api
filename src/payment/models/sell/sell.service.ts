import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSellDto } from 'src/payment/models/sell/dto/create-sell.dto';
import { UpdateSellDto } from 'src/payment/models/sell/dto/update-sell.dto';
import { SellRepository } from 'src/payment/models/sell/sell.repository';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { Sell } from './sell.entity';
import { DepositService } from '../deposit/deposit.service';
import { User } from '../../../user/models/user/user.entity';
import { StakingService } from '../staking/staking.service';
import { Util } from 'src/shared/util';
import { KycService } from 'src/user/models/kyc/kyc.service';
import { Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserService } from 'src/user/models/user/user.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { Config } from 'src/config/config';

@Injectable()
export class SellService {
  constructor(
    private readonly sellRepo: SellRepository,
    private readonly fiatService: FiatService,
    private readonly depositService: DepositService,
    private readonly stakingService: StakingService,
    private readonly kycService: KycService,
    private readonly userService: UserService,
    private readonly bankAccountService: BankAccountService,
  ) {}

  async getSellByAddress(depositAddress: string): Promise<Sell> {
    // does not work with find options
    return this.sellRepo
      .createQueryBuilder('sell')
      .leftJoinAndSelect('sell.deposit', 'deposit')
      .leftJoinAndSelect('sell.user', 'user')
      .leftJoinAndSelect('user.userData', 'userData')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  async getUserSells(userId: number): Promise<Sell[]> {
    return this.sellRepo.find({ user: { id: userId } });
  }

  async createSell(userId: number, dto: CreateSellDto): Promise<Sell> {
    // check user data
    const dataComplete = await this.kycService.userDataComplete(userId);
    if (!dataComplete) throw new BadRequestException('Ident data incomplete');

    // check fiat
    const fiat = await this.fiatService.getFiat(dto.fiat.id);
    if (!fiat) throw new BadRequestException('Fiat not found');

    // remove spaces in IBAN
    dto.iban = dto.iban.split(' ').join('');

    // check if exists
    const existing = await this.sellRepo.findOne({ where: { iban: dto.iban, fiat: fiat, user: { id: userId } } });
    if (existing) throw new ConflictException('Sell route already exists');

    // create the entity
    const sell = this.sellRepo.create(dto);
    sell.user = { id: userId } as User;
    sell.fiat = fiat;
    sell.deposit = await this.depositService.getNextDeposit();
    sell.bankAccount = await this.bankAccountService.getBankAccount(dto.iban, userId);

    return this.sellRepo.save(sell);
  }

  async updateSell(userId: number, sellId: number, dto: UpdateSellDto): Promise<Sell> {
    const sell = await this.sellRepo.findOne({ id: sellId, user: { id: userId } });
    if (!sell) throw new NotFoundException('Sell route not found');

    return await this.sellRepo.save({ ...sell, ...dto });
  }

  async count(): Promise<number> {
    return this.sellRepo.count();
  }

  // --- VOLUMES --- //
  @Cron(CronExpression.EVERY_YEAR)
  async resetAnnualVolumes(): Promise<void> {
    this.sellRepo.update({ annualVolume: Not(0) }, { annualVolume: 0 });
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

  async getUserSellDepositsInUse(userId: number): Promise<number[]> {
    const stakingRoutes = await this.stakingService.getUserStaking(userId);
    return stakingRoutes
      .filter((s) => s.active)
      .map((s) => [
        s.deposit?.id === s.paybackDeposit?.id ? undefined : s.paybackDeposit?.id,
        s.deposit?.id === s.rewardDeposit?.id ? undefined : s.rewardDeposit?.id,
      ])
      .reduce((prev, curr) => prev.concat(curr), [])
      .filter((id) => id);
  }
}
