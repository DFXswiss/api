import { EntityRepository, Repository } from 'typeorm';
import { CryptoStaking } from './crypto-staking.entity';

@EntityRepository(CryptoStaking)
export class CryptoStakingRepository extends Repository<CryptoStaking> {}
