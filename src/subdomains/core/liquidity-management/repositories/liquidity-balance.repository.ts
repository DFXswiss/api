import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';

@Injectable()
export class LiquidityBalanceRepository extends BaseRepository<LiquidityBalance> {
  constructor(manager: EntityManager) {
    super(LiquidityBalance, manager);
  }
}
