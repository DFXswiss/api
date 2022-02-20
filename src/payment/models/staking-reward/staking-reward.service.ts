import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not } from 'typeorm';
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
    let entity = await this.rewardRepo.findOne({
      where: [{ staking: { id: dto.stakingId }, txId: dto.txId }, { internalId: dto.internalId }],
    });
    if (entity)
      throw new ConflictException(
        'There is already a staking reward for the specified staking route and txId or the internal id is already used',
      );

    entity = await this.createEntity(dto);
    entity = await this.rewardRepo.save(entity);

    await this.updateRewardVolume([entity.staking.id]);

    return entity;
  }

  async update(id: number, dto: UpdateStakingRewardDto): Promise<StakingReward> {
    let entity = await this.rewardRepo.findOne(id, { relations: ['staking', 'staking.user'] });
    if (!entity) throw new NotFoundException('Staking reward not found');

    const internalIdWithOtherReward = dto.internalId
      ? await this.rewardRepo.findOne({ id: Not(id), internalId: dto.internalId })
      : null;
    if (internalIdWithOtherReward)
      throw new ConflictException('There is already a reward for the specified internal id');

    const routeIdBefore = entity.staking?.id;

    const update = await this.createEntity(dto);

    Util.removeNullFields(entity);

    entity = await this.rewardRepo.save({ ...update, ...entity });

    await this.updateRewardVolume([routeIdBefore, entity.staking?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const stakingIds = await this.stakingRepo.find().then((l) => l.map((b) => b.id));
    await this.updateRewardVolume(stakingIds);
  }

  async getUserRewards(userId: number): Promise<StakingReward[]> {
    return await this.rewardRepo.find({
      where: { staking: { user: { id: userId } } },
      relations: ['staking', 'staking.user'],
    });
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateStakingRewardDto | UpdateStakingRewardDto): Promise<StakingReward> {
    const reward = this.rewardRepo.create(dto);

    // staking
    if (dto.stakingId) {
      reward.staking = await this.stakingRepo.findOne(dto.stakingId);
      if (!reward.staking) throw new BadRequestException('Staking route not found');
    }

    return reward;
  }

  private async updateRewardVolume(stakingIds: number[]): Promise<void> {
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
}
