import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'backfill_debug_staff_verified_name_spec';
const STAFF_NAME_ENV = 'STAFF_VERIFIED_NAME_403938';
const ACCOUNT_ID = 403938;
const OTHER_ACCOUNT_ID = 111222;
const OTHER_ACCOUNT_NAME = 'Other Cleared Staff';

let BackfillDebugStaffVerifiedName: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('BackfillDebugStaffVerifiedName migration (SQL content)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackfillDebugStaffVerifiedName = require('../../../../../../../migration/1785635000000-BackfillDebugStaffVerifiedName');
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

      await new BackfillDebugStaffVerifiedName().up(queryRunner as unknown as QueryRunner);

      expect(queryRunner.query).not.toHaveBeenCalled();
    },
  );

  it.each([[undefined], [''], ['   ']])(
    'fails before issuing SQL when the PRD deployment variable is %p',
    async (staffName) => {
      process.env.ENVIRONMENT = 'prd';
      setEnv(STAFF_NAME_ENV, staffName);
      const queryRunner = { query: jest.fn(async (_sql: string) => []) };

      await expect(new BackfillDebugStaffVerifiedName().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
        `${STAFF_NAME_ENV} is required`,
      );
      expect(queryRunner.query).not.toHaveBeenCalled();
    },
  );

  it('issues one parameterized, audited update on PRD and never inlines the name', async () => {
    process.env.ENVIRONMENT = 'prd';
    process.env[STAFF_NAME_ENV] = '  Test Staff Name  ';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ clearedCount: 1 }]),
    };

    await new BackfillDebugStaffVerifiedName().up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const [sql, parameters] = queryRunner.query.mock.calls[0];
    expect(parameters[0]).toBe('Test Staff Name');
    expect(sql).toContain('INSERT INTO "log"');
    expect(sql).toContain("'StaffVerifiedNameBackfill'");
    expect(sql).toContain("'previousVerifiedName'");
    expect(sql).toContain("'nextVerifiedName'");
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "audit")');
    expect(sql).toContain('SET "verifiedName" = $1::varchar, "updated" = now()');
    expect(sql).toContain(String(ACCOUNT_ID));
    expect(sql).not.toContain('Test Staff Name');

    // The precondition must be the exact negation of the postcondition — otherwise a present-but-blank
    // name is a state the update refuses to produce and the assertion refuses to accept, and the deploy
    // dies on a row the migration itself could have repaired.
    expect(sql).toContain("BTRIM(COALESCE(\"verifiedName\", ''), $2::varchar) = ''");
    expect(sql).toContain("'action', CASE WHEN \"needsBackfill\" THEN 'backfilled' ELSE 'keptExistingName' END");

    const [postconditionSql, postconditionParameters] = queryRunner.query.mock.calls[1];
    expect(postconditionSql).toContain('AS "clearedCount"');
    expect(postconditionSql).toContain('BTRIM("verifiedName", $1::varchar)');
    // The postcondition asserts the clearance predicate, not equality with the supplied name.
    expect(postconditionSql).not.toContain('"verifiedName" = $');
    expect(postconditionParameters[0]).toBe(parameters[1]);
  });

  it('rejects when the account does not reach the cleared state', async () => {
    process.env.ENVIRONMENT = 'prd';
    process.env[STAFF_NAME_ENV] = 'Test Staff Name';
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ clearedCount: 0 }]),
    };

    await expect(new BackfillDebugStaffVerifiedName().up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      `did not reach the required state for user data ${ACCOUNT_ID}`,
    );
  });

  it('down() deliberately performs no rollback', async () => {
    const migration = new BackfillDebugStaffVerifiedName();

    expect(migration.down).toHaveLength(0);
    await expect(migration.down()).resolves.toBeUndefined();
  });
});

describeDb('BackfillDebugStaffVerifiedName migration (real Postgres)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackfillDebugStaffVerifiedName = require('../../../../../../../migration/1785635000000-BackfillDebugStaffVerifiedName');
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

  // The non-target account carries a cleared name on purpose: an unscoped postcondition would then
  // count it too, so `count(*) = 1` only holds while the assertion stays pinned to ACCOUNT_ID.
  async function insertAccounts(
    targetName: string | null = null,
    otherName: string | null = OTHER_ACCOUNT_NAME,
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "user_data" ("id", "updated", "verifiedName")
       VALUES (${ACCOUNT_ID}, TIMESTAMP '2000-01-01', $1), (${OTHER_ACCOUNT_ID}, TIMESTAMP '2000-01-01', $2)`,
      [targetName, otherName],
    );
  }

  async function readAccounts(): Promise<{ id: number; verifiedName: string | null }[]> {
    return queryRunner.query(`SELECT "id", "verifiedName" FROM "user_data" ORDER BY "id"`);
  }

  it('backfills the target, updates its timestamp, and records one before/after audit row', async () => {
    await insertAccounts();

    await new BackfillDebugStaffVerifiedName().up(queryRunner);

    const users = (await queryRunner.query(
      `SELECT "id", "verifiedName", "updated" > TIMESTAMP '2000-01-01' AS "wasUpdated"
       FROM "user_data" ORDER BY "id"`,
    )) as { id: number; verifiedName: string | null; wasUpdated: boolean }[];
    expect(users).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME, wasUpdated: false },
      { id: ACCOUNT_ID, verifiedName: 'Test Staff Name', wasUpdated: true },
    ]);

    const logs = (await queryRunner.query(
      `SELECT "message" FROM "log" WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId: ACCOUNT_ID,
        previousVerifiedName: null,
        nextVerifiedName: 'Test Staff Name',
        action: 'backfilled',
      },
    ]);
  });

  it('is idempotent and does not append another audit row on a second run', async () => {
    await insertAccounts();
    const migration = new BackfillDebugStaffVerifiedName();

    await migration.up(queryRunner);
    await migration.up(queryRunner);

    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as { count: number }[];
    expect(logCount[0].count).toBe(1);
    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
  });

  // `BlankChars` is defined as every character `String.prototype.trim()` strips, so derive that set from
  // the runtime instead of restating it, and assert the migration's duplicated copy repairs a name built
  // from all of them at once. A copy that lost a code point — the drift the migration's own comment warns
  // about — would leave such a name unrepaired and then fail its own assertion.
  it('repairs a name built from every character trim() strips, pinning the duplicated BlankChars', async () => {
    const blankChars = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter(
      (char) => char.trim() === '',
    );
    await insertAccounts(blankChars.join(''));

    await new BackfillDebugStaffVerifiedName().up(queryRunner);

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
  });

  // A blank name clears no account — the gate's predicate is BTRIM-based, not IS NOT NULL. Repairing it
  // is the whole point of widening the precondition: a name of a single tab would otherwise be a row the
  // migration refuses to fix and then refuses to accept, taking the boot down with it.
  it.each([['\t'], ['   '], ['\u00a0'], ['\ufeff']])('repairs a blank verifiedName (%j)', async (blank) => {
    await insertAccounts(blank);

    await new BackfillDebugStaffVerifiedName().up(queryRunner);

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
    const logs = (await queryRunner.query(`SELECT "message" FROM "log"`)) as { message: string }[];
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId: ACCOUNT_ID,
        previousVerifiedName: blank,
        nextVerifiedName: 'Test Staff Name',
        action: 'backfilled',
      },
    ]);
  });

  // The deliberate deviation from #4574: an identity-verified path may have written a different, valid
  // name. That account is cleared, so the migration must leave it alone and must NOT fail the deploy —
  // but the divergence between the reviewed value and the deployed one must not be silent.
  it('leaves an existing verified name untouched, records the divergence, and still succeeds', async () => {
    await insertAccounts('Existing Verified Name');

    await expect(new BackfillDebugStaffVerifiedName().up(queryRunner)).resolves.toBeUndefined();

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: ACCOUNT_ID, verifiedName: 'Existing Verified Name' },
    ]);
    const logs = (await queryRunner.query(`SELECT "message" FROM "log"`)) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId: ACCOUNT_ID,
        previousVerifiedName: 'Existing Verified Name',
        nextVerifiedName: 'Existing Verified Name',
        action: 'keptExistingName',
      },
    ]);
  });

  it('rejects when the target row is absent and relies on the migration transaction to roll back', async () => {
    await queryRunner.query(`INSERT INTO "user_data" ("id", "verifiedName") VALUES (${OTHER_ACCOUNT_ID}, $1)`, [
      OTHER_ACCOUNT_NAME,
    ]);
    await queryRunner.startTransaction();

    await expect(new BackfillDebugStaffVerifiedName().up(queryRunner)).rejects.toThrow(
      `did not reach the required state for user data ${ACCOUNT_ID}`,
    );

    // Read INSIDE the transaction: after the rollback every write is gone regardless, so the same
    // assertion afterwards would hold even if the migration had written an audit row.
    const logs = (await queryRunner.query(`SELECT "message" FROM "log"`)) as { message: string }[];
    expect(logs).toHaveLength(0);

    await queryRunner.rollbackTransaction();
  });

  it('changes nothing when a trigger suppresses the audit insert', async () => {
    await insertAccounts();
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

    await expect(new BackfillDebugStaffVerifiedName().up(queryRunner)).rejects.toThrow(
      `did not reach the required state for user data ${ACCOUNT_ID}`,
    );

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: ACCOUNT_ID, verifiedName: null },
    ]);
    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as { count: number }[];
    expect(logCount[0].count).toBe(0);
  });
});
