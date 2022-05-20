import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, In, Not } from 'typeorm';
import { StakingRefRewardRepository } from './staking-ref-reward.repository';
import { StakingRefReward, StakingRefType } from './staking-ref-reward.entity';
import { UserService } from 'src/user/models/user/user.service';
import { Util } from 'src/shared/util';

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
  ) {}

  async create(dto: CreateStakingRefReward): Promise<StakingRefReward> {
    let entity = await this.stakingRefRewardRepo.findOne({
      where: [{ user: { id: dto.userId }, txId: dto.txId, staking: { id: dto.stakingId } }],
    });
    if (entity)
      throw new ConflictException(
        'There is already a ref reward for the specified user and txId or staking id is already used',
      );

    entity = await this.createEntity(dto);
    entity = await this.stakingRefRewardRepo.save(entity);

    await this.updatePaidStakingRefCredit([entity.user.id]);

    return entity;
  }

  async update(id: number, dto: UpdateStakingRefReward): Promise<StakingRefReward> {
    let entity = await this.stakingRefRewardRepo.findOne(id, { relations: ['user', 'staking', 'staking.user'] });
    if (!entity) throw new NotFoundException('Ref reward not found');

    const userIdBefore = entity.user?.id;

    const update = await this.createEntity(dto);

    Util.removeNullFields(entity);

    entity = await this.stakingRefRewardRepo.save({ ...update, ...entity });

    await this.updatePaidStakingRefCredit([userIdBefore, entity.user?.id]);

    return entity;
  }

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

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateStakingRefReward | UpdateStakingRefReward): Promise<StakingRefReward> {
    const reward = this.stakingRefRewardRepo.create(dto);

    // route
    if (dto.userId) {
      reward.user = await this.userService.getUser(dto.userId);
      if (!reward.user) throw new BadRequestException('User not found');
    }

    return reward;
  }

  private async updatePaidStakingRefCredit(userIds: number[]): Promise<void> {
    userIds = userIds.filter((u, j) => userIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of userIds) {
      const { volume } = await this.stakingRefRewardRepo
        .createQueryBuilder('stakingRefReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('stakingRefReward.user', 'user')
        .where('user.id = :id', { id })
        .getRawOne<{ volume: number }>();

      await this.userService.updatePaidStakingRefCredit(id, volume ?? 0);
    }
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
}
