import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { TradingRule } from '../entities/trading-rule.entity';

@Injectable()
export class TradingRuleRepository extends BaseRepository<TradingRule> {
  constructor(manager: EntityManager) {
    super(TradingRule, manager);
  }
}
