import { EntityRepository, Repository } from 'typeorm';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';

@EntityRepository(LiquidityManagementPipeline)
export class LiquidityManagementPipelineRepository extends Repository<LiquidityManagementPipeline> {}
