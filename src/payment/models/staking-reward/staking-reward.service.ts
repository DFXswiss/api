import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between } from 'typeorm';
import { CreateStakingRewardDto } from './dto/create-staking-reward.dto';
import { StakingReward } from './staking-reward.entity';
import { RewardRepository } from './staking-reward.respository';
import { UpdateStakingRewardDto } from './dto/update-staking-reward.dto';
import { StakingRepository } from '../staking/staking.repository';
import { RewardType } from '../reward/reward.entity';
import { StakingService } from '../staking/staking.service';

@Injectable()
export class StakingRewardService {
  constructor(
    private readonly rewardRepo: RewardRepository,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
  ) {}

  async create(dto: CreateStakingRewardDto): Promise<StakingReward> {
    let entity = await this.rewardRepo.findOne({ route: { id: dto.routeId } });
    if (entity) throw new ConflictException('There is already a crypto buy for the specified bank TX');

    entity = await this.createEntity(dto);
    entity = await this.rewardRepo.save(entity);

    await this.updateStakingVolume([entity.route.id]);

    return entity;
  }

  async update(id: number, dto: UpdateStakingRewardDto): Promise<StakingReward> {
    let entity = await this.rewardRepo.findOne(id, { relations: ['staking', 'staking.user'] });
    if (!entity) throw new NotFoundException('No matching entry found');

    // const bankTxWithOtherBuy = dto.routeId
    //   ? await this.rewardRepo.findOne({ id: Not(id), bankTx: { id: dto.bankTxId } })
    //   : null;
    // if (bankTxWithOtherBuy) throw new ConflictException('There is already a crypto buy for the specified bank Tx');

    const routeIdBefore = entity.route?.id;

    const update = await this.createEntity(dto);

    entity = await this.rewardRepo.save({ ...entity, ...update });

    await this.updateStakingVolume([routeIdBefore, entity.route?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const stakingIds = await this.stakingRepo.find().then((l) => l.map((b) => b.id));
    await this.updateStakingVolume(stakingIds);
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateStakingRewardDto | UpdateStakingRewardDto): Promise<StakingReward> {
    const reward = this.rewardRepo.create(dto);

    // route
    if (dto.routeId) {
      reward.route = await this.stakingRepo.findOne(dto.routeId);
      if (!reward.route) throw new NotFoundException('No Staking Route for ID found');
    }

    return reward;
  }

  private async updateStakingVolume(stakingIds: number[]): Promise<void> {
    stakingIds = stakingIds.filter((u, j) => stakingIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of stakingIds) {
      const { volume } = await this.rewardRepo
        .createQueryBuilder('reward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('reward.route', 'stakingRoute')
        .where('stakingRoute.id = :id', { id: id })
        .andWhere('type = :check', { check: RewardType.STAKING })
        .getRawOne<{ volume: number }>();

      await this.stakingService.updateRewardVolume(id, volume ?? 0);
    }
  }

  async getTransactions(
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<{ date: Date; outputAmount: number; outputAsset: string }[]> {
    if (!dateFrom) dateFrom = new Date('15 Aug 2021 00:00:00 GMT');
    if (!dateTo) dateTo = new Date();

    const stakingReward = await this.rewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), type: RewardType.STAKING },
      relations: ['route'],
    });

    return stakingReward.map((v) => ({
      date: v.outputDate,
      outputAmount: v.outputAmount,
      outputAsset: v.outputAsset,
    }));
  }
}
