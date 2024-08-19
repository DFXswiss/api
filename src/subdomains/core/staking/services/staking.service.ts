import { Injectable } from '@nestjs/common';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { Between, In, IsNull, Not } from 'typeorm';
import { CryptoStaking } from '../entities/crypto-staking.entity';
import { StakingRefReward } from '../entities/staking-ref-reward.entity';
import { PayoutType, StakingReward } from '../entities/staking-reward.entity';
import { CryptoStakingRepository } from '../repositories/crypto-staking.repository';
import { StakingRefRewardRepository } from '../repositories/staking-ref-reward.repository';
import { StakingRewardRepository } from '../repositories/staking-reward.repository';
import { StakingRepository } from '../repositories/staking.repository';

interface RouteIdentifier {
  id: number;
  address: string;
  blockchains: string;
}

@Injectable()
export class StakingService {
  constructor(
    private readonly stakingRewardRepo: StakingRewardRepository,
    private readonly stakingRefRewardRepo: StakingRefRewardRepository,
    private readonly cryptoStakingRepo: CryptoStakingRepository,
    private readonly stakingRepository: StakingRepository,
    private readonly payInService: PayInService,
  ) {}

  // --- HISTORY METHODS --- //

  async getUserStakingRewards(
    userIds: number[],
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<StakingReward[]> {
    return this.stakingRewardRepo.find({
      where: { staking: { user: { id: In(userIds) } }, outputDate: Between(dateFrom, dateTo), txId: Not(IsNull()) },
      relations: ['staking', 'staking.user'],
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
      relations: ['user'],
    });
  }

  async getUserInvests(
    userId: number,
    dateFrom: Date = new Date(0),
    dateTo: Date = new Date(),
  ): Promise<{ deposits: CryptoStaking[]; withdrawals: CryptoStaking[] }> {
    const cryptoStaking = await this.cryptoStakingRepo.find({
      where: [
        { stakingRoute: { user: { id: userId } }, inputDate: Between(dateFrom, dateTo), isReinvest: false },
        {
          stakingRoute: { user: { id: userId } },
          outputDate: Between(dateFrom, dateTo),
          payoutType: Not(PayoutType.REINVEST),
        },
      ],
      relations: ['cryptoInput', 'stakingRoute', 'stakingRoute.user'],
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
