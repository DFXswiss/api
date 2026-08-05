import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'liquidity_order_awaiting_finalization_spec';
const INDEX = 'IDX_35b02b963661233664a9821d03';

let AddLiquidityOrderAwaitingFinalizationIndex: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

const load = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../../migration/1785900000000-AddLiquidityOrderAwaitingFinalizationIndex');

describe('AddLiquidityOrderAwaitingFinalizationIndex migration (SQL content)', () => {
  beforeAll(() => {
    AddLiquidityOrderAwaitingFinalizationIndex = load();
  });

  it('creates the partial index under the name TypeORM derives for the entity declaration', async () => {
    const migration = new AddLiquidityOrderAwaitingFinalizationIndex();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.up(queryRunner as unknown as QueryRunner);

    const sql = (queryRunner.query.mock.calls as [string][]).map(([statement]) => statement).join('\n');

    expect(sql).toContain(`SET LOCAL lock_timeout = '5s'`);
    expect(sql).toContain(
      `CREATE INDEX "${INDEX}" ON "liquidity_order" ("id") WHERE "isReady" = false AND "txId" IS NOT NULL`,
    );
  });

  it('down() drops the index', async () => {
    const migration = new AddLiquidityOrderAwaitingFinalizationIndex();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.down(queryRunner as unknown as QueryRunner);

    const sql = (queryRunner.query.mock.calls as [string][]).map(([statement]) => statement).join('\n');

    expect(sql).toContain(`DROP INDEX "public"."${INDEX}"`);
  });
});

/**
 * The point of this half. `DexService.finalizePurchaseOrders` reads
 * `findBy({ isReady: false, txId: Not(IsNull()) })`, and TypeORM renders `Not(IsNull())` as
 * `NOT("txId" IS NULL)` — its `not` and `isNull` operators are composed, not folded into an
 * `IS NOT NULL` (see QueryBuilder.createWhereConditionExpression). The index predicate is spelled
 * `IS NOT NULL`, so the two are textually different and the index only applies if PostgreSQL
 * canonicalises the negated null test before matching index predicates.
 *
 * It does — but "it does" is the kind of claim that is worth an assertion rather than a comment,
 * because nothing would fail if it stopped being true. A TypeORM release that changes operator
 * rendering, or a rewrite of the query into another equivalent form, would leave the index in place
 * and silently stop using it, and the only symptom would be the sequential scan this migration
 * exists to remove coming back.
 */
describeDb('AddLiquidityOrderAwaitingFinalizationIndex migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    AddLiquidityOrderAwaitingFinalizationIndex = load();
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    await queryRunner.query(`
      CREATE TABLE "liquidity_order" (
        "id" SERIAL PRIMARY KEY,
        "isReady" boolean NOT NULL DEFAULT false,
        "txId" varchar(256)
      )
    `);

    // Enough rows that a sequential scan is the expensive option, with the predicate matching only
    // a handful — the shape the job actually sees, and the only shape in which the planner has a
    // reason to prefer the index.
    await queryRunner.query(`
      INSERT INTO "liquidity_order" ("isReady", "txId")
      SELECT true, 'tx-' || g FROM generate_series(1, 5000) g
    `);
    await queryRunner.query(`
      INSERT INTO "liquidity_order" ("isReady", "txId")
      SELECT false, 'standing-' || g FROM generate_series(1, 3) g
    `);
  });

  afterEach(async () => {
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('creates a partial index the planner uses for the predicate TypeORM generates', async () => {
    await new AddLiquidityOrderAwaitingFinalizationIndex().up(queryRunner);
    await queryRunner.query(`ANALYZE "liquidity_order"`);

    // Exactly what TypeORM emits for findBy({ isReady: false, txId: Not(IsNull()) }).
    const plan: { 'QUERY PLAN': string }[] = await queryRunner.query(
      `EXPLAIN SELECT * FROM "liquidity_order" WHERE "isReady" = false AND NOT("txId" IS NULL)`,
    );
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    expect(text).toContain(INDEX);
    expect(text).not.toContain('Seq Scan');
  });

  it('leaves the sequential scan in place without the migration, so the index is what changed the plan', async () => {
    await queryRunner.query(`ANALYZE "liquidity_order"`);

    const plan: { 'QUERY PLAN': string }[] = await queryRunner.query(
      `EXPLAIN SELECT * FROM "liquidity_order" WHERE "isReady" = false AND NOT("txId" IS NULL)`,
    );

    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain('Seq Scan');
  });

  it('down() removes the index again', async () => {
    const migration = new AddLiquidityOrderAwaitingFinalizationIndex();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const rows = await queryRunner.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename = 'liquidity_order'`,
    );

    expect(rows.map((row: { indexname: string }) => row.indexname)).not.toContain(INDEX);
  });
});
