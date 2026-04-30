import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { PriceRule } from '../domain/entities/price-rule.entity';

@Injectable()
export class PriceRuleRepository extends BaseRepository<PriceRule> {
  constructor(manager: EntityManager) {
    super(PriceRule, manager);
  }
}
