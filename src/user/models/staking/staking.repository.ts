import { EntityRepository, Repository } from 'typeorm';
import { Staking } from './staking.entity';

@EntityRepository(Staking)
export class StakingRepository extends Repository<Staking> {}
