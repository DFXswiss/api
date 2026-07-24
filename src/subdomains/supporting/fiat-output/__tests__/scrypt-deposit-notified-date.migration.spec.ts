import { DataSource, getMetadataArgsStorage, QueryRunner } from 'typeorm';
import { FiatOutput } from '../fiat-output.entity';
import { SCRYPT_DEPOSIT_NAME_MARKER } from '../fiat-output-job.service';

describe('AddFiatOutputScryptDepositNotifiedDate migration', () => {
  it('adds the column, backfills completed Scrypt LiqManagement rows, and sets lock timeout', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Migration = require('../../../../../migration/1784700000001-AddFiatOutputScryptDepositNotifiedDate');
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };

    await new Migration().up(queryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('SET LOCAL lock_timeout');
    expect(sql).toContain('ALTER TABLE "fiat_output" ADD "scryptDepositNotifiedDate" TIMESTAMP');
    expect(sql).toContain('2026-07-23 12:00:00');
    expect(sql).toContain(`LIKE '%${SCRYPT_DEPOSIT_NAME_MARKER}%'`);
    expect(sql).toContain(`"type" = 'LiqManagement'`);
    expect(sql).toContain(`"isComplete" = true`);
    expect(sql).toContain(`"scryptDepositNotifiedDate" IS NULL`);
  });

  it('drops the scryptDepositNotifiedDate column on rollback', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Migration = require('../../../../../migration/1784700000001-AddFiatOutputScryptDepositNotifiedDate');
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };

    await new Migration().down(queryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('DROP COLUMN "scryptDepositNotifiedDate"');
  });
});

describe('FiatOutput Scrypt deposit notified date column metadata', () => {
  it('declares scryptDepositNotifiedDate as a nullable timestamp, aligned with the migration DDL', () => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === FiatOutput && c.propertyName === 'scryptDepositNotifiedDate',
    );

    expect(column).toBeDefined();
    expect(column.options.type).toBe('timestamp');
    expect(column.options.nullable).toBe(true);
  });
});

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'scrypt_deposit_notified_date_spec';

let AddFiatOutputScryptDepositNotifiedDate: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describeDb('AddFiatOutputScryptDepositNotifiedDate migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddFiatOutputScryptDepositNotifiedDate = require('../../../../../migration/1784700000001-AddFiatOutputScryptDepositNotifiedDate');
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
      CREATE TABLE "fiat_output" (
        "id" SERIAL PRIMARY KEY,
        "isComplete" boolean NOT NULL DEFAULT FALSE,
        "type" varchar(256),
        "name" varchar(256)
      )
    `);
    // Fixture rows in a fixed order: (1) matches every backfill condition -> gets the fixed
    // timestamp; (2) wrong type; (3) name without the marker; (4) isComplete = false -> all three
    // stay NULL.
    await queryRunner.query(`
      INSERT INTO "fiat_output" ("isComplete", "type", "name") VALUES
      (true, 'LiqManagement', 'Payout ${SCRYPT_DEPOSIT_NAME_MARKER}'),
      (true, 'BuyFiat', 'Payout ${SCRYPT_DEPOSIT_NAME_MARKER}'),
      (true, 'LiqManagement', 'Unrelated counterparty'),
      (false, 'LiqManagement', 'Payout ${SCRYPT_DEPOSIT_NAME_MARKER}')
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

  it('adds a nullable timestamp column, backfills only matching rows, and removes the column on rollback', async () => {
    const migration = new AddFiatOutputScryptDepositNotifiedDate();

    await queryRunner.startTransaction();
    await migration.up(queryRunner);
    const columnInfo = await getColumnInfo();
    const notifiedDates = await getNotifiedDates();
    await queryRunner.commitTransaction();

    expect(columnInfo).toEqual({ data_type: 'timestamp without time zone', is_nullable: 'YES' });
    // Formatted as text (not parsed as a JS Date) so the assertion is independent of the test
    // runner's local timezone - the migration writes a naive TIMESTAMP literal.
    expect(notifiedDates).toEqual(['2026-07-23 12:00:00', null, null, null]);

    await queryRunner.startTransaction();
    await migration.down(queryRunner);
    const columnExistsAfterDown = await hasNotifiedDateColumn();
    await queryRunner.commitTransaction();

    expect(columnExistsAfterDown).toBe(false);
  });

  async function getColumnInfo(): Promise<{ data_type: string; is_nullable: string } | undefined> {
    const rows = await queryRunner.query(
      `SELECT data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'fiat_output' AND column_name = 'scryptDepositNotifiedDate'`,
      [SCHEMA],
    );
    return rows[0];
  }

  async function getNotifiedDates(): Promise<(string | null)[]> {
    const rows = await queryRunner.query(
      `SELECT to_char("scryptDepositNotifiedDate", 'YYYY-MM-DD HH24:MI:SS') AS notified
       FROM "fiat_output" ORDER BY "id"`,
    );
    return rows.map((r: { notified: string | null }) => r.notified);
  }

  async function hasNotifiedDateColumn(): Promise<boolean> {
    const rows = await queryRunner.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'fiat_output' AND column_name = 'scryptDepositNotifiedDate'`,
      [SCHEMA],
    );
    return rows.length > 0;
  }
});
