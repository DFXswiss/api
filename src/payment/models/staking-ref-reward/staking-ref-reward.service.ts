import { Injectable } from '@nestjs/common';
import { Between, In, Not } from 'typeorm';
import { StakingRefRewardRepository } from './staking-ref-reward.repository';
import { StakingRefReward, StakingRefType } from './staking-ref-reward.entity';
import { UserService } from 'src/user/models/user/user.service';
import { User } from 'src/user/models/user/user.entity';
import { Config } from 'src/config/config';
import { Staking } from '../staking/staking.entity';
import { ConversionService } from 'src/shared/services/conversion.service';

export interface CreateStakingRefReward {
  txId: string;
  outputDate: Date;
  stakingId?: number;
  userId: number;
  stakingRefType: StakingRefType;
}

export interface UpdateStakingRefReward {
  txId: string;
  outputDate?: Date;
  stakingId?: number;
  userId?: number;
  stakingRefType?: StakingRefType;
}

@Injectable()
export class StakingRefRewardService {
  constructor(
    private readonly stakingRefRewardRepo: StakingRefRewardRepository,
    private readonly userService: UserService,
    private readonly conversionService: ConversionService,
  ) {}

  async create(staking: Staking): Promise<void> {
    if (!staking.user) throw new Error('User is null');
    if (staking.user.created < Config.staking.refSystemStart || staking.user.usedRef === '000-000') return;

    const refUser = await this.userService.getRefUser(staking.user.usedRef);
    if (!refUser) return;

    const entities = [await this.createEntity(staking.user, staking), await this.createEntity(refUser)];
    await this.stakingRefRewardRepo.save(entities);
  }

  // async update(id: number, dto: UpdateStakingRefReward): Promise<StakingRefReward> {
  //   let entity = await this.stakingRefRewardRepo.findOne(id, { relations: ['user', 'staking', 'staking.user'] });
  //   if (!entity) throw new NotFoundException('Ref reward not found');

  //   const userIdBefore = entity.user?.id;

  //   const update = await this.createEntity(dto);

  //   Util.removeNullFields(entity);

  //   entity = await this.stakingRefRewardRepo.save({ ...update, ...entity });

  //   await this.updatePaidStakingRefCredit([userIdBefore, entity.user?.id]);

  //   return entity;
  // }

  async updateVolumes(): Promise<void> {
    const userIds = await this.userService.getAllUser().then((l) => l.map((b) => b.id));
    await this.updatePaidStakingRefCredit(userIds);
  }

  async getUserRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingRefReward[]> {
    return await this.stakingRefRewardRepo.find({
      where: { user: { id: In(userIds) }, outputDate: Between(dateFrom, dateTo), txId: Not(null) },
      relations: ['user'],
    });
  }

  async getAllUserRewards(userIds: number[]): Promise<StakingRefReward[]> {
    return await this.stakingRefRewardRepo.find({
      where: { user: { id: In(userIds) } },
      relations: ['user'],
    });
  }

  async getTransactions(
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const refRewards = await this.stakingRefRewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo) },
    });

    return refRewards.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.outputAsset,
    }));
  }

  // --- HELPER METHODS --- //
  private async createEntity(user: User, staking?: Staking): Promise<StakingRefReward> {
    return this.stakingRefRewardRepo.create({
      user: user,
      staking: staking,
      stakingRefType: staking ? StakingRefType.REFERRED : StakingRefType.REFERRER,
      inputAmount: Config.staking.refReward,
      inputAsset: 'EUR',
      inputReferenceAmount: Config.staking.refReward,
      inputReferenceAsset: 'EUR',
      amountInChf: await this.conversionService.convertFiat(Config.staking.refReward, 'EUR', 'CHF'),
      amountInEur: Config.staking.refReward,
    });
  }

  private async updatePaidStakingRefCredit(userIds: number[]): Promise<void> {
    userIds = userIds.filter((u, j) => userIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of userIds) {
      const { volume } = await this.stakingRefRewardRepo
        .createQueryBuilder('stakingRefReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('stakingRefReward.user', 'user')
        .where('user.id = :id', { id })
        .andWhere('txId IS NOT NULL')
        .getRawOne<{ volume: number }>();

      await this.userService.updatePaidStakingRefCredit(id, volume ?? 0);
    }
  }
}
