import { DataSource, QueryRunner } from 'typeorm';

// Runs the real migration against a throwaway Postgres. Skipped without a connection string, the gate
// the other migration specs use.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'address_letter_dispatch_state_spec';

// Plain CommonJS (module.exports = class ...); required lazily inside beforeAll so a skipped run never
// pulls the .js through the TS transform.
let AddAddressLetterDispatchState: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describeDb('AddAddressLetterDispatchState migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddAddressLetterDispatchState = require('../../../../../../../migration/1785900000000-AddAddressLetterDispatchState');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    // minimal prerequisite schema: only what the migration touches
    await queryRunner.query(`
      CREATE TABLE "user_data" ("id" SERIAL PRIMARY KEY, "letterSentDate" timestamp)
    `);
    await queryRunner.query(`
      CREATE TABLE "setting" (
        "id" SERIAL PRIMARY KEY,
        "updated" timestamp NOT NULL DEFAULT NOW(),
        "created" timestamp NOT NULL DEFAULT NOW(),
        "key" varchar(256) UNIQUE NOT NULL,
        "value" text NOT NULL
      )
    `);
    // two accounts, one of them already served by the automation this job replaces
    await queryRunner.query(`INSERT INTO "user_data" ("letterSentDate") VALUES (NULL), (NOW())`);
  });

  afterEach(async () => {
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  const columns = (): Promise<{ column_name: string; data_type: string; is_nullable: string }[]> =>
    queryRunner.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = '${SCHEMA}' AND table_name = 'user_data'
         AND column_name IN ('letterClaimDate', 'letterFailures')
       ORDER BY column_name`,
    );

  const disabledProcesses = async (): Promise<string[]> => {
    const rows = await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = 'disabledProcess'`);
    return rows.length ? JSON.parse(rows[0].value) : [];
  };

  it('adds both dispatch-state columns and removes them again on rollback', async () => {
    const migration = new AddAddressLetterDispatchState();

    await queryRunner.startTransaction();
    await migration.up(queryRunner);
    const added = await columns();
    // every existing row starts unclaimed with no failures - what "never touched by the job" means,
    // and what keeps the observer's sentWithoutFile metric restricted to this job's own dispatches
    const [rows] = await queryRunner.query(
      `SELECT COUNT(*)::int AS untouched FROM "user_data" WHERE "letterClaimDate" IS NULL AND "letterFailures" = 0`,
    );
    await queryRunner.commitTransaction();

    expect(added).toEqual([
      { column_name: 'letterClaimDate', data_type: 'timestamp without time zone', is_nullable: 'YES' },
      { column_name: 'letterFailures', data_type: 'integer', is_nullable: 'NO' },
    ]);
    expect(rows.untouched).toBe(2);

    await queryRunner.startTransaction();
    await migration.down(queryRunner);
    const removed = await columns();
    await queryRunner.commitTransaction();

    expect(removed).toEqual([]);
  });

  it('switches the job off, so it can never start on its own', async () => {
    const migration = new AddAddressLetterDispatchState();

    await queryRunner.startTransaction();
    await migration.up(queryRunner);
    const afterUp = await disabledProcesses();
    await queryRunner.commitTransaction();

    // The dispatch sends physical mail while the automation it replaces is still live. Enabling it is
    // a deliberate act; forgetting an environment entry must not be enough to start it.
    expect(afterUp).toEqual(['AddressLetter']);

    await queryRunner.startTransaction();
    await migration.down(queryRunner);
    const afterDown = await disabledProcesses();
    await queryRunner.commitTransaction();

    expect(afterDown).toEqual([]);
  });

  it('appends to an existing list without disturbing or duplicating entries', async () => {
    await queryRunner.query(
      `INSERT INTO "setting" ("key", "value") VALUES ('disabledProcess', '["ExistingProcess","AddressLetter"]')`,
    );
    const migration = new AddAddressLetterDispatchState();

    await queryRunner.startTransaction();
    await migration.up(queryRunner);
    const afterUp = await disabledProcesses();
    await queryRunner.commitTransaction();

    expect(afterUp).toEqual(['ExistingProcess', 'AddressLetter']);

    await queryRunner.startTransaction();
    await migration.down(queryRunner);
    const afterDown = await disabledProcesses();
    await queryRunner.commitTransaction();

    // rollback removes only its own entry
    expect(afterDown).toEqual(['ExistingProcess']);
  });
});
