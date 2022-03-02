import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not } from 'typeorm';
import { RefRewardRepository } from './ref-reward.repository';
import { CreateRefRewardDto } from './dto/create-ref-reward.dto';
import { RefReward } from './ref-reward.entity';
import { UpdateRefRewardDto } from './dto/update.ref-reward.dto';
import { UserService } from 'src/user/models/user/user.service';
import { Util } from 'src/shared/util';

@Injectable()
export class RefRewardService {
  constructor(private readonly rewardRepo: RefRewardRepository, private readonly userService: UserService) {}

  async create(dto: CreateRefRewardDto): Promise<RefReward> {
    let entity = await this.rewardRepo.findOne({
      where: [{ user: { id: dto.userId }, txId: dto.txId }, { internalId: dto.internalId }],
    });
    if (entity)
      throw new ConflictException(
        'There is already a ref reward for the specified user and txId or the internal id is already used',
      );

    entity = await this.createEntity(dto);
    entity = await this.rewardRepo.save(entity);

    await this.updatePaidRefCredit([entity.user.id]);

    return entity;
  }

  async update(id: number, dto: UpdateRefRewardDto): Promise<RefReward> {
    let entity = await this.rewardRepo.findOne(id, { relations: ['user'] });
    if (!entity) throw new NotFoundException('Ref reward not found');

    const internalIdWithOtherReward = dto.internalId
      ? await this.rewardRepo.findOne({ id: Not(id), internalId: dto.internalId })
      : null;
    if (internalIdWithOtherReward)
      throw new ConflictException('There is already a ref reward for the specified internal id');

    const userIdBefore = entity.user?.id;

    const update = await this.createEntity(dto);

    Util.removeNullFields(entity);

    entity = await this.rewardRepo.save({ ...update, ...entity });

    await this.updatePaidRefCredit([userIdBefore, entity.user?.id]);

    return entity;
  }

  async updateVolumes(): Promise<void> {
    const userIds = await this.userService.getAllUser().then((l) => l.map((b) => b.id));
    await this.updatePaidRefCredit(userIds);
  }

  async getUserRewards(userId: number): Promise<RefReward[]> {
    return await this.rewardRepo.find({
      where: { user: { id: userId } },
      relations: ['user'],
    });
  }

  // --- HELPER METHODS --- //
  private async createEntity(dto: CreateRefRewardDto | UpdateRefRewardDto): Promise<RefReward> {
    const reward = this.rewardRepo.create(dto);

    // route
    if (dto.userId) {
      reward.user = await this.userService.getUser(dto.userId);
      if (!reward.user) throw new BadRequestException('User not found');
    }

    return reward;
  }

  private async updatePaidRefCredit(userIds: number[]): Promise<void> {
    userIds = userIds.filter((u, j) => userIds.indexOf(u) === j).filter((i) => i); // distinct, not null

    for (const id of userIds) {
      const { volume } = await this.rewardRepo
        .createQueryBuilder('refReward')
        .select('SUM(amountInEur)', 'volume')
        .innerJoin('refReward.user', 'user')
        .where('user.id = :id', { id })
        .getRawOne<{ volume: number }>();

      await this.userService.updatePaidRefCredit(id, volume ?? 0);
    }
  }
}
