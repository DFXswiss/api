import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Raw } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { DepositService } from '../deposit/deposit.service';
import { SellRepository } from '../sell/sell.repository';
import { User } from '../user/user.entity';
import { KycStatus } from '../userData/userData.entity';
import { UserDataRepository } from '../userData/userData.repository';
import { CreateStakingDto } from './dto/create-staking.dto';
import { StakingType } from './dto/staking-type.enum';
import { UpdateStakingDto } from './dto/update-staking.dto';
import { Staking } from './staking.entity';
import { StakingRepository } from './staking.repository';

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRepo: StakingRepository,
    private readonly depositService: DepositService,
    private readonly sellRepo: SellRepository,
    private readonly userDataRepo: UserDataRepository,
  ) {}

  async getStakingForAddress(depositAddress: string): Promise<Staking> {
    // does not work with find options
    return this.stakingRepo
      .createQueryBuilder('staking')
      .leftJoinAndSelect('staking.deposit', 'deposit')
      .where('deposit.address = :addr', { addr: depositAddress })
      .getOne();
  }

  async getStaking(id: number, userId: number): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ where: { id, user: { id: userId } } });
    if (!staking) throw new NotFoundException('No matching staking route for id found');

    return staking;
  }

  async getAllStaking(userId: number): Promise<Staking[]> {
    return this.stakingRepo.find({ user: { id: userId } });
  }

  async createStaking(userId: number, dto: CreateStakingDto): Promise<Staking> {
    // KYC check
    const { kycStatus } = await this.userDataRepo
      .createQueryBuilder('userData')
      .innerJoinAndSelect('userData.users', 'user')
      .where('user.id = :id', { id: userId })
      .getOne();
    if (![KycStatus.WAIT_MANUAL, KycStatus.COMPLETED].includes(kycStatus)) throw new BadRequestException('Missing KYC');

    const rewardDepositId =
      dto.rewardType === StakingType.PAYOUT ? await this.getDepositId(userId, dto.rewardSell?.id) : null;
    const paybackDepositId =
      dto.paybackType === StakingType.PAYOUT ? await this.getDepositId(userId, dto.paybackSell?.id) : null;

    // check if exists
    const existing = await this.stakingRepo.findOne({
      where: {
        rewardDeposit: { id: dto.rewardType === StakingType.REINVEST ? Raw('depositId') : rewardDepositId },
        paybackDeposit: { id: dto.paybackType === StakingType.REINVEST ? Raw('depositId') : paybackDepositId },
        user: { id: userId },
      },
      relations: ['rewardDeposit', 'paybackDeposit'],
    });
    if (existing) throw new ConflictException('Staking route already exists');

    // create the entity
    const staking = this.stakingRepo.create({});
    staking.user = { id: userId } as User;
    staking.deposit = await this.depositService.getNextDeposit();
    staking.rewardDeposit =
      dto.rewardType === StakingType.REINVEST ? staking.deposit : ({ id: rewardDepositId } as Deposit);
    staking.paybackDeposit =
      dto.paybackType === StakingType.REINVEST ? staking.deposit : ({ id: paybackDepositId } as Deposit);

    return this.stakingRepo.save(staking);
  }

  async updateStaking(userId: number, dto: UpdateStakingDto): Promise<Staking> {
    const staking = await this.stakingRepo.findOne({ id: dto.id, user: { id: userId } });
    if (!staking) throw new NotFoundException('No matching entry found');

    return await this.stakingRepo.save({ ...staking, ...dto });
  }

  private async getDepositId(userId: number, sellId?: number): Promise<number> {
    const sell = await this.sellRepo.findOne({ where: { id: sellId, user: { id: userId } }, relations: ['deposit'] });
    if (!sell) throw new BadRequestException('Missing sell route');

    return sell.deposit.id;
  }
}
