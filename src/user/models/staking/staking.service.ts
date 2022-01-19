import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Raw } from 'typeorm';
import { Deposit } from '../deposit/deposit.entity';
import { DepositService } from '../deposit/deposit.service';
import { SellRepository } from '../sell/sell.repository';
import { User } from '../user/user.entity';
import { CreateStakingDto, StakingType } from './dto/create-staking.dto';
import { Staking } from './staking.entity';
import { StakingRepository } from './staking.repository';

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRepo: StakingRepository,
    private readonly depositService: DepositService,
    private readonly sellRepo: SellRepository,
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
    // TODO: check user data => KYC status >= Manual
    // const verification = await this.userService.verifyUser(userId);
    // if (!verification.result) throw new BadRequestException('User data missing');

    const rewardDepositId = dto.rewardType === StakingType.SELL ? await this.getDepositId(dto.rewardSell?.id) : null;
    const paybackDepositId = dto.paybackType === StakingType.SELL ? await this.getDepositId(dto.paybackSell?.id) : null;

    // check if exists
    const existing = await this.stakingRepo.findOne({
      where: {
        rewardDeposit: { id: dto.rewardType === StakingType.REINVEST ? Raw('id') : rewardDepositId }, // TODO: test
        paybackDeposit: { id: dto.rewardType === StakingType.REINVEST ? Raw('id') : paybackDepositId },
        user: { id: userId },
      },
    });
    if (existing) throw new ConflictException('Staking route already exists');

    // create the entity
    const staking = this.stakingRepo.create({});
    staking.user = { id: userId } as User;
    staking.deposit = await this.depositService.getNextDeposit();
    staking.rewardDeposit = dto.rewardType === StakingType.REINVEST ? staking.deposit : { id: rewardDepositId } as Deposit;
    staking.paybackDeposit = dto.rewardType === StakingType.REINVEST ? staking.deposit : { id: paybackDepositId } as Deposit;

    return this.stakingRepo.save(staking);
  }

  private async getDepositId(sellId?: number): Promise<number> {
    const sell = await this.sellRepo.findOne({ where: { id: sellId }, relations: ['deposit'] });
    if (!sell) throw new BadRequestException('Missing sell route');

    return sell.deposit.id;
  }
}
