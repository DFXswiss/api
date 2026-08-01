import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'backfill_staff_verified_names_spec';
const STAFF_NAME_ENV = 'STAFF_VERIFIED_NAME_375162';
const GSHEET_ADDRESS = '0x791D0AeC86EE6a86d260543ECD57d7932A7fec2D';

let BackfillStaffVerifiedNames: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('BackfillStaffVerifiedNames migration (SQL content)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackfillStaffVerifiedNames = require('../../../../../../../migration/1785584840000-BackfillStaffVerifiedNames');
  });

  afterEach(() => {
    setEnv('ENVIRONMENT', originalEnvironment);
    setEnv(STAFF_NAME_ENV, originalStaffName);
  });

  it.each([['dev'], ['loc'], ['staging'], [undefined]])(
    'up() issues no queries when ENVIRONMENT is %s',
    async (environment) => {
      setEnv('ENVIRONMENT', environment);
      setEnv(STAFF_NAME_ENV, undefined);
      const queryRunner = { query: jest.fn(async (_sql: string) => []) };

      await new BackfillStaffVerifiedNames().up(queryRunner as unknown as QueryRunner);

      expect(queryRunner.query).not.toHaveBeenCalled();
    },
  );

  it.each([[undefined], [''], ['   ']])('fails before issuing SQL when the PRD secret is %p', async (staffName) => {
    process.env.ENVIRONMENT = 'prd';
    setEnv(STAFF_NAME_ENV, staffName);
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await expect(new BackfillStaffVerifiedNames().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `${STAFF_NAME_ENV} is required`,
    );
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  it('issues one parameterized, audited update on PRD', async () => {
    process.env.ENVIRONMENT = 'prd';
    process.env[STAFF_NAME_ENV] = '  Test Staff Name  ';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ humanCount: 1, serviceCount: 1 }]),
    };

    await new BackfillStaffVerifiedNames().up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const [sql, parameters] = queryRunner.query.mock.calls[0];
    expect(parameters).toEqual(['Test Staff Name']);
    expect(sql).toContain('INSERT INTO "log"');
    expect(sql).toContain("'StaffVerifiedNameBackfill'");
    expect(sql).toContain("'previousVerifiedName'");
    expect(sql).toContain("'nextVerifiedName'");
    expect(sql).toContain('FOR UPDATE OF ud');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "audit")');
    expect(sql).toContain('SET "verifiedName" = a."nextVerifiedName", "updated" = now()');
    expect(sql).toContain(GSHEET_ADDRESS);
    expect(sql).not.toContain('Test Staff Name');

    const [postconditionSql, postconditionParameters] = queryRunner.query.mock.calls[1];
    expect(postconditionParameters).toEqual(['Test Staff Name']);
    expect(postconditionSql).toContain('AS "humanCount"');
    expect(postconditionSql).toContain('AS "serviceCount"');
  });

  it('rejects when either target does not reach the exact required state', async () => {
    process.env.ENVIRONMENT = 'prd';
    process.env[STAFF_NAME_ENV] = 'Test Staff Name';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ humanCount: 1, serviceCount: 0 }]),
    };

    await expect(new BackfillStaffVerifiedNames().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      'did not reach the required state for both target accounts',
    );
  });

  it('down() deliberately performs no rollback', async () => {
    const migration = new BackfillStaffVerifiedNames();

    expect(migration.down).toHaveLength(0);
    await expect(migration.down()).resolves.toBeUndefined();
  });
});

describeDb('BackfillStaffVerifiedNames migration (real Postgres)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackfillStaffVerifiedNames = require('../../../../../../../migration/1785584840000-BackfillStaffVerifiedNames');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    process.env.ENVIRONMENT = 'prd';
    process.env[STAFF_NAME_ENV] = 'Test Staff Name';
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);
    await queryRunner.query(`
      CREATE TABLE "user_data" (
        "id" integer PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "verifiedName" varchar(256)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" SERIAL PRIMARY KEY,
        "address" varchar(256),
        "userDataId" integer REFERENCES "user_data"("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "log" (
        "id" SERIAL PRIMARY KEY,
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "system" varchar(256) NOT NULL,
        "subsystem" varchar(256) NOT NULL,
        "severity" varchar(256) NOT NULL,
        "message" text NOT NULL
      )
    `);
  });

  afterEach(async () => {
    setEnv('ENVIRONMENT', originalEnvironment);
    setEnv(STAFF_NAME_ENV, originalStaffName);
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function insertTargets(humanName: string | null = null, serviceName: string | null = null): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "user_data" ("id", "updated", "verifiedName")
       VALUES (375162, TIMESTAMP '2000-01-01', $1), (318765, TIMESTAMP '2000-01-01', $2)`,
      [humanName, serviceName],
    );
    await queryRunner.query(`INSERT INTO "user" ("address", "userDataId") VALUES ($1, 318765)`, [GSHEET_ADDRESS]);
  }

  it('backfills both targets, updates their timestamps, and records one before/after audit row', async () => {
    await insertTargets();

    await new BackfillStaffVerifiedNames().up(queryRunner);

    const users = (await queryRunner.query(
      `SELECT "id", "verifiedName", "updated" > TIMESTAMP '2000-01-01' AS "wasUpdated"
       FROM "user_data" ORDER BY "id"`,
    )) as { id: number; verifiedName: string | null; wasUpdated: boolean }[];
    expect(users).toEqual([
      { id: 318765, verifiedName: 'GSheet', wasUpdated: true },
      { id: 375162, verifiedName: 'Test Staff Name', wasUpdated: true },
    ]);

    const logs = (await queryRunner.query(
      `SELECT "message" FROM "log" WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      { userDataId: 318765, previousVerifiedName: null, nextVerifiedName: 'GSheet' },
      { userDataId: 375162, previousVerifiedName: null, nextVerifiedName: 'Test Staff Name' },
    ]);
  });

  it('is idempotent and does not append another audit row on a second run', async () => {
    await insertTargets();
    const migration = new BackfillStaffVerifiedNames();

    await migration.up(queryRunner);
    await migration.up(queryRunner);

    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as {
      count: number;
    }[];
    expect(logCount[0].count).toBe(1);
  });

  it('rejects an unexpected existing name and relies on the migration transaction to roll back', async () => {
    await insertTargets('Existing Staff Name');
    await queryRunner.startTransaction();

    await expect(new BackfillStaffVerifiedNames().up(queryRunner)).rejects.toThrow(
      'did not reach the required state for both target accounts',
    );
    await queryRunner.rollbackTransaction();

    const users = (await queryRunner.query(`SELECT "id", "verifiedName" FROM "user_data" ORDER BY "id"`)) as {
      id: number;
      verifiedName: string | null;
    }[];
    expect(users).toEqual([
      { id: 318765, verifiedName: null },
      { id: 375162, verifiedName: 'Existing Staff Name' },
    ]);

    const logs = (await queryRunner.query(`SELECT "message" FROM "log"`)) as { message: string }[];
    expect(logs).toHaveLength(0);
  });

  it('changes nothing when a trigger suppresses the audit insert', async () => {
    await insertTargets();
    await queryRunner.query(`
      CREATE FUNCTION suppress_log_insert() RETURNS trigger AS $fn$
      BEGIN
        RETURN NULL;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER suppress_log_insert_trigger
      BEFORE INSERT ON "log"
      FOR EACH ROW
      EXECUTE FUNCTION suppress_log_insert()
    `);

    await expect(new BackfillStaffVerifiedNames().up(queryRunner)).rejects.toThrow(
      'did not reach the required state for both target accounts',
    );

    const users = (await queryRunner.query(`SELECT "verifiedName" FROM "user_data" ORDER BY "id"`)) as {
      verifiedName: string | null;
    }[];
    expect(users).toEqual([{ verifiedName: null }, { verifiedName: null }]);
    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as {
      count: number;
    }[];
    expect(logCount[0].count).toBe(0);
  });
});
