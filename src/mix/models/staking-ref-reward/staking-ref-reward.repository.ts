import { EntityRepository, Repository } from 'typeorm';
import { StakingRefReward } from './staking-ref-reward.entity';

@EntityRepository(StakingRefReward)
export class StakingRefRewardRepository extends Repository<StakingRefReward> {}
