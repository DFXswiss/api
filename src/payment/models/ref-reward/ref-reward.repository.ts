import { EntityRepository, Repository } from 'typeorm';
import { RefReward } from './ref-reward.entity';

@EntityRepository(RefReward)
export class RewardRepository extends Repository<RefReward> {}
