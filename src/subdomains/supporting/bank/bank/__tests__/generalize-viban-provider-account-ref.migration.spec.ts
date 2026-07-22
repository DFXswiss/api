import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'generalize_viban_provider_account_ref_spec';

let GeneralizeVibanProviderAccountRef: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('GeneralizeVibanProviderAccountRef migration (SQL content)', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GeneralizeVibanProviderAccountRef = require('../../../../../../migration/1784600000000-GeneralizeVibanProviderAccountRef');
  });

  it('renames yapealAccountUid to providerAccountRef on up and reverses on down', async () => {
    const migration = new GeneralizeVibanProviderAccountRef();
    const queryRunner = { query: jest.fn(async (_sql: string) => undefined) };

    await migration.up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query.mock.calls[0]).toHaveLength(1);
    expect(queryRunner.query.mock.calls[0][0]).toBe(
      `ALTER TABLE "virtual_iban" RENAME COLUMN "yapealAccountUid" TO "providerAccountRef"`,
    );
    expect(queryRunner.query.mock.calls[0][0]).not.toMatch(/\[/);

    queryRunner.query.mockClear();
    await migration.down(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query.mock.calls[0]).toHaveLength(1);
    expect(queryRunner.query.mock.calls[0][0]).toBe(
      `ALTER TABLE "virtual_iban" RENAME COLUMN "providerAccountRef" TO "yapealAccountUid"`,
    );
    expect(queryRunner.query.mock.calls[0][0]).not.toMatch(/\[/);
  });
});

describeDb('GeneralizeVibanProviderAccountRef migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GeneralizeVibanProviderAccountRef = require('../../../../../../migration/1784600000000-GeneralizeVibanProviderAccountRef');
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
      CREATE TABLE "virtual_iban" (
        "id" SERIAL PRIMARY KEY,
        "yapealAccountUid" varchar(256)
      )
    `);
  });

  afterEach(async () => {
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('renames the column up and down', async () => {
    const migration = new GeneralizeVibanProviderAccountRef();

    await migration.up(queryRunner);
    let columns = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'virtual_iban'
      ORDER BY column_name
    `);
    expect(columns.map((c: { column_name: string }) => c.column_name)).toEqual(['id', 'providerAccountRef']);

    await migration.down(queryRunner);
    columns = await queryRunner.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${SCHEMA}' AND table_name = 'virtual_iban'
      ORDER BY column_name
    `);
    expect(columns.map((c: { column_name: string }) => c.column_name)).toEqual(['id', 'yapealAccountUid']);
  });
});
