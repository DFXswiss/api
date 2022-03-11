import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Between, Not } from 'typeorm';
import { CreateStakingRewardDto } from './dto/create-staking-reward.dto';
import { StakingReward } from './staking-reward.entity';
import { StakingRewardRepository } from './staking-reward.respository';
import { UpdateStakingRewardDto } from './dto/update-staking-reward.dto';
import { StakingRepository } from '../staking/staking.repository';
import { StakingService } from '../staking/staking.service';
import { Util } from 'src/shared/util';
import { MasternodeService } from '../masternode/masternode.service';

@Injectable()
export class StakingRewardService {
  constructor(
    private readonly rewardRepo: StakingRewardRepository,
    private readonly stakingRepo: StakingRepository,
    private readonly stakingService: StakingService,
    private readonly masternodeService: MasternodeService,
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

  async getUserRewards(
    userId: number,
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<StakingReward[]> {
    return await this.rewardRepo.find({
      where: { staking: { user: { id: userId } }, outputDate: Between(dateFrom, dateTo) },
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
  async getTotalVolume(): Promise<number> {
    return this.rewardRepo
      .createQueryBuilder('stakingReward')
      .select('SUM(amountInEur)', 'volume')
      .getRawOne<{ volume: number }>()
      .then((r) => r.volume);
  }

  async getTransactions(
    dateFrom: Date = new Date('15 Aug 2021 00:00:00 GMT'),
    dateTo: Date = new Date(),
  ): Promise<{ fiatAmount: number; fiatCurrency: string; date: Date; cryptoAmount: number; cryptoCurrency: string }[]> {
    const stakingRewards = await this.rewardRepo.find({
      where: { outputDate: Between(dateFrom, dateTo) },
    });

    return stakingRewards.map((v) => ({
      id: v.id,
      fiatAmount: v.amountInEur,
      fiatCurrency: 'EUR',
      date: v.outputDate,
      cryptoAmount: v.outputAmount,
      cryptoCurrency: v.outputAsset,
      payoutType: v.payoutType,
    }));
  }

  public async getYield(): Promise<{ apr: number; apy: number }> {
    const stakingRewards = await this.getTransactions(this.getLastWeeksDate(), new Date());
    const rewardSum = stakingRewards.reduce((a, b) => a + b.cryptoAmount, 0);
    const stakingCollateral = await this.masternodeService.getCount();
    const apr = await this.getApr(+rewardSum, +stakingCollateral * 20000);
    return {
      apr: Util.round(apr, 2),
      apy: Util.round(this.getApy(apr), 2),
    };
  }

  private getLastWeeksDate(): Date {
    const now = new Date();
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  private async getApr(stakingRewards: number, stakingCollateral: number): Promise<number> {
    return (stakingRewards / stakingCollateral) * (365 / 7);
  }

  private getApy(stakingApr: number): number {
    return Math.pow(1 + stakingApr / 365, 365) - 1;
  }
}
