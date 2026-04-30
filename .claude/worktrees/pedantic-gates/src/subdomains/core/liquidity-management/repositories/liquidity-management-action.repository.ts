import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityManagementAction } from '../entities/liquidity-management-action.entity';

@Injectable()
export class LiquidityManagementActionRepository extends BaseRepository<LiquidityManagementAction> {
  constructor(manager: EntityManager) {
    super(LiquidityManagementAction, manager);
  }
}
