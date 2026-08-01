import { Injectable } from '@nestjs/common';
import { ReadProjection } from 'src/shared/models/read-projection';
import { BaseRepository } from 'src/shared/repositories/base.repository';
import { EntityManager } from 'typeorm';
import { LiquidityManagementPipeline } from '../entities/liquidity-management-pipeline.entity';

/** The single value `GET /liquidityManagement/pipeline/:id/status` answers with. */
export const PIPELINE_STATUS_RESPONSE_FIELDS = ['pipeline.status'];

/**
 * `GET /liquidityManagement/pipeline/:id/status` — 112 columns before, for one.
 *
 * The pipeline expands its rule and its current action eagerly, and the rule pulls in its asset and
 * its currency, so asking for the row by id fetched the whole graph to read a status string.
 */
export const PIPELINE_STATUS_PROJECTION = new ReadProjection<LiquidityManagementPipeline>(
  'pipeline',
  [],
  PIPELINE_STATUS_RESPONSE_FIELDS,
  // Never shown, but without the primary key the ORM has nothing to identify the row by.
  ['pipeline.id'],
);

@Injectable()
export class LiquidityManagementPipelineRepository extends BaseRepository<LiquidityManagementPipeline> {
  constructor(manager: EntityManager) {
    super(LiquidityManagementPipeline, manager);
  }

  /**
   * One pipeline, carrying its status and nothing else.
   *
   * Returns the row rather than the status so that a missing pipeline stays distinguishable from a
   * pipeline whose status is not set — the endpoint answers 404 only for the first.
   *
   * `fields` exists for the mutation test; nothing in production passes it.
   */
  async findForStatus(
    id: number,
    fields: ReadonlyArray<string> = PIPELINE_STATUS_PROJECTION.fields,
  ): Promise<LiquidityManagementPipeline> {
    return PIPELINE_STATUS_PROJECTION.apply(this.createQueryBuilder('pipeline'), fields)
      .where('pipeline.id = :id', { id })
      .getOne();
  }
}
