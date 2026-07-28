import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'custody_order_completed_at_spec';

let AddCustodyOrderCompletedAt: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('AddCustodyOrderCompletedAt migration (SQL content)', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddCustodyOrderCompletedAt = require('../../../../../migration/1785196928914-AddCustodyOrderCompletedAt');
  });

  it('adds the column and backfills only Completed rows without overwriting existing values', async () => {
    const migration = new AddCustodyOrderCompletedAt();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    const sql = calls.map(([statement]) => statement).join('\n');

    for (const call of calls) {
      expect(call).toHaveLength(1);
    }

    expect(sql).toContain(`ALTER TABLE "custody_order" ADD "completedAt" TIMESTAMP`);
    expect(sql).toContain(`SET "completedAt" = "updated"`);
    expect(sql).toContain(`"status" = 'Completed'`);
    expect(sql).toContain(`"completedAt" IS NULL`);
  });

  it('down() drops the column', async () => {
    const migration = new AddCustodyOrderCompletedAt();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.down(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    const sql = calls.map(([statement]) => statement).join('\n');

    for (const call of calls) {
      expect(call).toHaveLength(1);
    }
    expect(sql).toContain(`ALTER TABLE "custody_order" DROP COLUMN "completedAt"`);
  });
});

describeDb('AddCustodyOrderCompletedAt migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddCustodyOrderCompletedAt = require('../../../../../migration/1785196928914-AddCustodyOrderCompletedAt');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    // Pre-migration shape: no completedAt column yet.
    await queryRunner.query(`
      CREATE TABLE "custody_order" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "status" varchar(256) NOT NULL DEFAULT 'Created'
      )
    `);

    await queryRunner.query(`
      INSERT INTO "custody_order" ("updated", "status")
      VALUES
        ('2026-01-15 10:00:00', 'Completed'),
        ('2026-01-20 11:00:00', 'InProgress')
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

  it('backfills completedAt with updated for Completed rows, leaves other statuses NULL', async () => {
    const migration = new AddCustodyOrderCompletedAt();
    await migration.up(queryRunner);

    const rows = await queryRunner.query(
      `SELECT "status", "updated", "completedAt" FROM "custody_order" ORDER BY "id"`,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('Completed');
    expect(rows[0].completedAt).toEqual(rows[0].updated);
    expect(rows[1].status).toBe('InProgress');
    expect(rows[1].completedAt).toBeNull();
  });

  it('down() removes the column', async () => {
    const migration = new AddCustodyOrderCompletedAt();
    await migration.up(queryRunner);
    await migration.down(queryRunner);

    const columns = await queryRunner.query(
      `SELECT "column_name" FROM information_schema.columns
       WHERE table_schema = '${SCHEMA}' AND table_name = 'custody_order' AND column_name = 'completedAt'`,
    );
    expect(columns).toHaveLength(0);
  });
});
