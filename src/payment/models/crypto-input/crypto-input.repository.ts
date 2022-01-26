import { Config } from 'src/config/config';
import { EntityRepository, Repository, SelectQueryBuilder } from 'typeorm';
import { RouteType } from '../route/deposit-route.entity';
import { CryptoInput } from './crypto-input.entity';

@EntityRepository(CryptoInput)
export class CryptoInputRepository extends Repository<CryptoInput> {
  async getStakingBalance(stakingId: number, date: Date): Promise<number> {
    const { balance } = await this.getInputsForStakingPeriod(date)
      .select('SUM(amount)', 'balance')
      .andWhere('route.id = :stakingId', { stakingId })
      .getRawOne<{ balance: number }>();

    return balance ?? 0;
  }

  async getAllStakingBalance(stakingIds: number[], date: Date): Promise<{ id: number; balance: number }[]> {
    const inputs = await this.getInputsForStakingPeriod(date)
      .andWhere('route.id IN (:...stakingIds)', { stakingIds })
      .getMany();

    return stakingIds.map((id) => ({
      id,
      balance: inputs.filter((i) => i.route.id === id).reduce((prev, curr) => prev + curr.amount, 0),
    }));
  }

  private getInputsForStakingPeriod(dateTo: Date): SelectQueryBuilder<CryptoInput> {
    const dateFrom = new Date(dateTo);
    dateFrom.setDate(dateTo.getDate() - Config.stakingPeriod);

    return this.createQueryBuilder('cryptoInput')
      .innerJoinAndSelect('cryptoInput.route', 'route')
      .where('route.type = :type', { type: RouteType.STAKING })
      .andWhere('cryptoInput.created BETWEEN :dateFrom AND :dateTo', { dateFrom, dateTo });
  }
}
