import {
  createProjectionDataSource,
  describeProjection,
  destroyProjectionDataSource,
  expectEveryFieldRequired,
  expectNoEmptyFields,
  projectionFieldsWithout,
  seedEntity,
} from 'src/shared/utils/projection-test.util';
import { LiquidityManagementPipeline } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-pipeline.entity';
import { LiquidityManagementRule } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-rule.entity';
import { LiquidityManagementPipelineStatus } from 'src/subdomains/core/liquidity-management/enums';
import {
  PIPELINE_STATUS_PROJECTION,
  PIPELINE_STATUS_RESPONSE_FIELDS,
  LiquidityManagementPipelineRepository,
} from 'src/subdomains/core/liquidity-management/repositories/liquidity-management-pipeline.repository';
import { DataSource } from 'typeorm';

const SCHEMA = 'pipeline_status_projection_spec';

/**
 * `GET /liquidityManagement/pipeline/:id/status` — the four levels from
 * `docs/read-path-projections.md`.
 *
 * The endpoint answers with one string. Asking for the row by id fetched 112 columns for it: the
 * pipeline expands its rule and both of its action relations eagerly, and the rule expands its own.
 */
describeProjection('liquidity management pipeline status — read-path projection', () => {
  let dataSource: DataSource;
  let pipelines: LiquidityManagementPipelineRepository;

  beforeAll(async () => {
    dataSource = await createProjectionDataSource(SCHEMA);
    pipelines = new LiquidityManagementPipelineRepository(dataSource.manager);
  }, 300000);

  afterAll(async () => {
    await destroyProjectionDataSource(dataSource, SCHEMA);
  });

  /**
   * One pipeline in the given status.
   *
   * `status` is set explicitly: it is a TypeScript enum in a text column and it is the whole
   * response, so a generated value would prove nothing about the projection.
   */
  async function seedPipeline(
    status = LiquidityManagementPipelineStatus.IN_PROGRESS,
  ): Promise<LiquidityManagementPipeline> {
    const rule = await seedEntity<LiquidityManagementRule>(dataSource, LiquidityManagementRule);
    return seedEntity<LiquidityManagementPipeline>(dataSource, LiquidityManagementPipeline, {
      values: { rule, status },
    });
  }

  /** The response the endpoint produces, through the projected query. */
  async function statusOf(id: number, fields = PIPELINE_STATUS_PROJECTION.fields) {
    const pipeline = await pipelines.findForStatus(id, fields);
    return pipeline?.status;
  }

  // --- LEVEL 1: completeness --- //

  it('level 1 — a pipeline answers with its status', async () => {
    const pipeline = await seedPipeline();

    expectNoEmptyFields(await statusOf(pipeline.id));
  }, 120000);

  // --- LEVEL 2: variants --- //

  it.each(Object.values(LiquidityManagementPipelineStatus))(
    'level 2 — a pipeline in status %s answers with that status',
    async (status) => {
      const pipeline = await seedPipeline(status);

      expect(await statusOf(pipeline.id)).toEqual(status);
    },
    120000,
  );

  it('level 2 — an unknown id resolves to nothing, so the endpoint can answer 404', async () => {
    const pipeline = await seedPipeline();

    // The distinction matters: the repository returns the row rather than the status, so a missing
    // pipeline stays separable from one whose status is not set.
    expect(await pipelines.findForStatus(pipeline.id + 1_000_000)).toBeNull();
  }, 120000);

  it('level 2 — the answer belongs to the pipeline that was asked for', async () => {
    const mine = await seedPipeline(LiquidityManagementPipelineStatus.COMPLETE);
    await seedPipeline(LiquidityManagementPipelineStatus.FAILED);

    expect(await statusOf(mine.id)).toEqual(LiquidityManagementPipelineStatus.COMPLETE);
  }, 120000);

  // --- LEVEL 3: mutation --- //

  it('level 3 — the status field is required', async () => {
    const pipeline = await seedPipeline();

    await expectEveryFieldRequired(PIPELINE_STATUS_RESPONSE_FIELDS, (omitted) =>
      statusOf(pipeline.id, projectionFieldsWithout(PIPELINE_STATUS_PROJECTION.fields, omitted)),
    );
  }, 300000);

  // --- LEVEL 4: consistency against a second source --- //

  it.each([LiquidityManagementPipelineStatus.CREATED, LiquidityManagementPipelineStatus.STOPPED])(
    'level 4 — for %s the projected answer equals the one from a full load',
    async (status) => {
      const pipeline = await seedPipeline(status);

      const projected = await statusOf(pipeline.id);
      // The unprojected load is the second source: the find the endpoint used before, with every
      // eager relation it pulls in.
      const full = await dataSource.getRepository(LiquidityManagementPipeline).findOneBy({ id: pipeline.id });

      expect(projected).toEqual(full.status);
    },
    120000,
  );
});
