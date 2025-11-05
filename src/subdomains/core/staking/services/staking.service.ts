import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { Process } from 'src/shared/services/process.service';
import { DfxCron } from 'src/shared/utils/cron';
import { Between, In, IsNull, Not } from 'typeorm';
import { CryptoStaking } from '../entities/crypto-staking.entity';
import { StakingRefReward } from '../entities/staking-ref-reward.entity';
import { PayoutType, StakingReward } from '../entities/staking-reward.entity';
import { CryptoStakingRepository } from '../repositories/crypto-staking.repository';
import { StakingRefRewardRepository } from '../repositories/staking-ref-reward.repository';
import { StakingRewardRepository } from '../repositories/staking-reward.repository';

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRewardRepo: StakingRewardRepository,
    private readonly stakingRefRewardRepo: StakingRefRewardRepository,
    private readonly cryptoStakingRepo: CryptoStakingRepository,
  ) {}

  @DfxCron(CronExpression.EVERY_MINUTE, { process: Process.STAKING_REWARD_OUTPUT_ENTITY_SYNC, timeout: 1800 })
  async syncOutputEntity(): Promise<void> {
    const entities = await this.stakingRewardRepo.find({
      where: { outputAssetEntity: { id: IsNull() } },
      relations: { staking: true },
      take: 5000,
    });

    for (const entity of entities) {
      if (entity.staking.rewardAsset.dexName === entity.outputAssetString)
        await this.stakingRewardRepo.update(entity.id, { outputAssetEntity: entity.staking.rewardAsset });
    }
  }

  // --- HISTORY METHODS --- //

  async getUserStakingRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingReward[]> {
    return this.stakingRewardRepo.find({
      where: { staking: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: { staking: { user: true } },
      order: { id: 'ASC' },
    });
  }

  async getUserStakingRefRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingRefReward[]> {
    return this.stakingRefRewardRepo.find({
      where: { user: { id: In(userIds) }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: { user: true },
    });
  }

  async getUserInvests(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ deposits: CryptoStaking[]; withdrawals: CryptoStaking[] }> {
    const cryptoStaking = await this.cryptoStakingRepo.find({
      where: [
        { stakingRoute: { user: { id: In(userIds) } }, inputDate: Between(dateFrom, dateTo), isReinvest: false },
        {
          stakingRoute: { user: { id: In(userIds) } },
          outputDate: Between(dateFrom, dateTo),
          payoutType: Not(PayoutType.REINVEST),
        },
      ],
      relations: { cryptoInput: true, stakingRoute: { user: true } },
      order: { id: 'ASC' },
    });

    return {
      deposits: cryptoStaking.filter(
        (entry) => entry.inputDate >= dateFrom && entry.inputDate <= dateTo && !entry.isReinvest,
      ),
      withdrawals: cryptoStaking.filter(
        (entry) =>
          entry.outTxId &&
          entry.outputDate >= dateFrom &&
          entry.outputDate <= dateTo &&
          entry.payoutType !== PayoutType.REINVEST,
      ),
    };
  }
}
