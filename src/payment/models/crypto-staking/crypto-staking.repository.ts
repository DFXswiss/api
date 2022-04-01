import { EntityRepository, Repository, SelectQueryBuilder } from 'typeorm';
import { CryptoStaking } from './crypto-staking.entity';

@EntityRepository(CryptoStaking)
export class CryptoStakingRepository extends Repository<CryptoStaking> {
  getActiveEntries(date: Date): SelectQueryBuilder<CryptoStaking> {
    return this.createQueryBuilder('cryptoStaking').where(
      'cryptoStaking.inputDate <= :date AND cryptoStaking.outputDate >= :date',
      { date },
    );
  }
}
