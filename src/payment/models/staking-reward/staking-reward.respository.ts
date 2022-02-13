import { EntityRepository, Repository } from 'typeorm';
import { StakingReward } from './staking-reward.entity';

@EntityRepository(StakingReward)
export class StakingRewardRepository extends Repository<StakingReward> {}
