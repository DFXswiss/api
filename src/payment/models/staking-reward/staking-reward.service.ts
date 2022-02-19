import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, Not } from 'typeorm';
import { CreateStakingRewardDto } from './dto/create-staking-reward.dto';
import { StakingReward } from './staking-reward.entity';
import { StakingRewardRepository } from './staking-reward.respository';
import { UpdateStakingRewardDto } from './dto/update-staking-reward.dto';
import { StakingRepository } from '../staking/staking.repository';
import { StakingService } from '../staking/staking.service';
import { Util } from 'src/shared/util';

@Injectable()
export class StakingRewardService {
  constructor(
    private readonly rewardRepo: StakingRewardRepository,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
  ) {}

  async create(dto: CreateStakingRewardDto): Promise<StakingReward> {
    let entity = await this.rewardRepo
      .createQueryBuilder('stakingReward')
      .innerJoin('stakingReward.staking', 'stakingRoute')
      .where('stakingRoute.id = :id', { id: dto.stakingId })
      .andWhere('stakingReward.txid = :txid', { txid: dto.txId })
      .orWhere('stakingReward.internalId = :internalId', { internalId: dto.internalId })
      .getRawOne();
    if (entity)
      throw new ConflictException(
        'There is already the same staking reward for the specified staking route and txId or the internal Id is already usedj',
      );

    entity = await this.createEntity(dto);
    entity = await this.rewardRepo.save(entity);

    await this.updateStakingVolume([entity.staking.id]);

    return entity;
  }

  async update(id: number, dto: UpdateStakingRewardDto): Promise<StakingReward> {
    let entity = await this.rewardRepo.findOne(id, { relations: ['staking', 'staking.user'] });
    if (!entity) throw new NotFoundException('No matching entry found');

    const internalIdWithOtherReward = dto.internalId
      ? await this.rewardRepo.findOne({ id: Not(id), internalId: dto.internalId })
      : null;
    if (internalIdWithOtherReward)
      throw new ConflictException('There is already a reward for the specified internal Id');

    const routeIdBefore = entity.staking?.id;

    const update = await this.createEntity(dto);

    Util.entityNullValueFilter(entity);

    entity = await this.rewardRepo.save({ ...update, ...entity });

    await this.updateStakingVolume([routeIdBefore, entity.staking?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const stakingIds = await this.stakingRepo.find().then((l) => l.map((b) => b.id));
    await this.updateStakingVolume(stakingIds);
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateStakingRewardDto | UpdateStakingRewardDto): Promise<StakingReward> {
    const reward = this.rewardRepo.create(dto);

    // staking
    if (dto.stakingId) {
      reward.staking = await this.stakingRepo.findOne(dto.stakingId);
      if (!reward.staking) throw new NotFoundException('No Staking Route for ID found');
    }

    return reward;
  }

  private async updateStakingVolume(stakingIds: number[]): Promise<void> {
    stakingIds = stakingIds.filter((u, j) => stakingIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of stakingIds) {
      const { volume } = await this.rewardRepo
        .createQueryBuilder('stakingReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('stakingReward.staking', 'stakingRoute')
        .where('stakingRoute.id = :id', { id: id })
        .getRawOne<{ volume: number }>();

      await this.stakingService.updateRewardVolume(id, volume ?? 0);
    }
  }

  async getRewards(
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<{ date: Date; outputAmount: number; outputAsset: string }[]> {
    if (!dateFrom) dateFrom = new Date('15 Aug 2021 00:00:00 GMT');
    if (!dateTo) dateTo = new Date();

    const stakingReward = await this.rewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo) },
      relations: ['staking'],
    });

    return stakingReward.map((v) => ({
      date: v.outputDate,
      outputAmount: v.outputAmount,
      outputAsset: v.outputAsset,
    }));
  }
}
