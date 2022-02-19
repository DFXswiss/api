import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, Not } from 'typeorm';
import { RefRewardRepository } from './ref-reward.repository';
import { CreateRefRewardDto } from './dto/create-ref-reward.dto';
import { RefReward } from './ref-reward.entity';
import { UpdateRefRewardDto } from './dto/update.ref-reward.dto';
import { UserService } from 'src/user/models/user/user.service';

@Injectable()
export class RefRewardService {
  constructor(private readonly rewardRepo: RefRewardRepository, private readonly userService: UserService) {}

  async create(dto: CreateRefRewardDto): Promise<RefReward> {
    let entity = await this.rewardRepo
      .createQueryBuilder('refReward')
      .innerJoin('refReward.user', 'user')
      .where('user.id = :id', { id: dto.userId })
      .andWhere('refReward.txid = :txid', { txid: dto.txId })
      .orWhere('refReward.internalId = :internalId', { internalId: dto.internalId })
      .getRawOne();
    if (entity)
      throw new ConflictException(
        'There is already the same ref reward for the specified user and txId or the internal Id is already used',
      );

    entity = await this.createEntity(dto);
    entity = await this.rewardRepo.save(entity);

    await this.updateRefPayedVolume([entity.user.id]);

    return entity;
  }

  async update(id: number, dto: UpdateRefRewardDto): Promise<RefReward> {
    let entity = await this.rewardRepo.findOne(id, { relations: ['user'] });
    if (!entity) throw new NotFoundException('No matching entry found');

    const internalIdWithOtherReward = dto.internalId
      ? await this.rewardRepo.findOne({ id: Not(id), internalId: dto.internalId })
      : null;
    if (internalIdWithOtherReward)
      throw new ConflictException('There is already a reward for the specified internal Id');

    const userIdBefore = entity.user?.id;

    const update = await this.createEntity(dto);

    //Object.fromEntries(Object.entries(entity).filter(([_, v]) => v != null));

    entity = await this.rewardRepo.save({ ...update, ...entity });

    await this.updateRefPayedVolume([userIdBefore, entity.user?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const userIds = await this.userService.getAllUser().then((l) => l.map((b) => b.id));
    await this.updateRefPayedVolume(userIds);
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateRefRewardDto | UpdateRefRewardDto): Promise<RefReward> {
    const reward = this.rewardRepo.create(dto);

    // route
    if (dto.userId) {
      reward.user = await this.userService.getUser(dto.userId);
      if (!reward.user) throw new NotFoundException('No user for ID found');
    }

    return reward;
  }

  private async updateRefPayedVolume(stakingIds: number[]): Promise<void> {
    stakingIds = stakingIds.filter((u, j) => stakingIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of stakingIds) {
      const { volume } = await this.rewardRepo
        .createQueryBuilder('refReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('refReward.user', 'user')
        .where('user.id = :id', { id: id })
        .getRawOne<{ volume: number }>();

      await this.userService.updateRewardVolume(id, volume ?? 0);
    }
  }

  async getRewards(
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<{ date: Date; outputAmount: number; outputAsset: string }[]> {
    if (!dateFrom) dateFrom = new Date('15 Aug 2021 00:00:00 GMT');
    if (!dateTo) dateTo = new Date();

    const refReward = await this.rewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo) },
      relations: ['user'],
    });

    return refReward.map((v) => ({
      date: v.outputDate,
      outputAmount: v.outputAmount,
      outputAsset: v.outputAsset,
    }));
  }
}
