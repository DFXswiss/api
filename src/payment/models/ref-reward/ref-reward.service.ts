import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between } from 'typeorm';
import { RewardType } from '../reward/reward.entity';
import { StakingService } from '../staking/staking.service';
import { RewardRepository } from './ref-reward.repository';
import { CreateRefRewardDto } from './dto/create-ref-reward.dto';
import { RefReward } from './ref-reward.entity';
import { UpdateRefRewardDto } from './dto/update.ref-reward.dto';
import { UserRepository } from 'src/user/models/user/user.repository';

@Injectable()
export class RefRewardService {
  constructor(
    private readonly rewardRepo: RewardRepository,
    private readonly userRepo: UserRepository,
    private readonly stakingService: StakingService,
  ) {}

  async create(dto: CreateRefRewardDto): Promise<RefReward> {
    let entity = await this.rewardRepo.findOne({ user: { id: dto.userId } });
    if (entity) throw new ConflictException('There is already a crypto buy for the specified bank TX');

    entity = await this.createEntity(dto);
    entity = await this.rewardRepo.save(entity);

    await this.updateRefPayedVolume([entity.user.id]);

    return entity;
  }

  async update(id: number, dto: UpdateRefRewardDto): Promise<RefReward> {
    let entity = await this.rewardRepo.findOne(id, { relations: ['staking', 'staking.user'] });
    if (!entity) throw new NotFoundException('No matching entry found');

    // const bankTxWithOtherBuy = dto.routeId
    //   ? await this.rewardRepo.findOne({ id: Not(id), bankTx: { id: dto.bankTxId } })
    //   : null;
    // if (bankTxWithOtherBuy) throw new ConflictException('There is already a crypto buy for the specified bank Tx');

    const userIdBefore = entity.user?.id;

    const update = await this.createEntity(dto);

    entity = await this.rewardRepo.save({ ...entity, ...update });

    await this.updateRefPayedVolume([userIdBefore, entity.user?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const stakingIds = await this.userRepo.find().then((l) => l.map((b) => b.id));
    await this.updateRefPayedVolume(stakingIds);
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateRefRewardDto | UpdateRefRewardDto): Promise<RefReward> {
    const reward = this.rewardRepo.create(dto);

    // route
    if (dto.userId) {
      reward.user = await this.userRepo.findOne(dto.userId);
      if (!reward.user) throw new NotFoundException('No Staking Route for ID found');
    }

    return reward;
  }

  private async updateRefPayedVolume(stakingIds: number[]): Promise<void> {
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

    const refReward = await this.rewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo), type: RewardType.REF },
      relations: ['user'],
    });

    return refReward.map((v) => ({
      date: v.outputDate,
      outputAmount: v.outputAmount,
      outputAsset: v.outputAsset,
    }));
  }
}
