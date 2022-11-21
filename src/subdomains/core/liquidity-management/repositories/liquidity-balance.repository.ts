import { EntityRepository, Repository } from 'typeorm';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';

@EntityRepository(LiquidityBalance)
export class LiquidityBalanceRepository extends Repository<LiquidityBalance> {}
