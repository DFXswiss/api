import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';

@Injectable()
export class LiquidityManagementPipelineRepository extends BaseRepository<LiquidityManagementPipeline> {
  constructor(manager: EntityManager) {
    super(LiquidityManagementPipeline, manager);
  }
}
