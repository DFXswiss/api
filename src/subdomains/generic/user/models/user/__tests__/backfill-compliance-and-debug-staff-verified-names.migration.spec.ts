import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'backfill_compliance_and_debug_staff_verified_names_spec';
const STAFF_NAME_ENV = 'STAFF_VERIFIED_NAME_395822';
const DEBUG_ACCOUNT_ID = 395822;
const COMPLIANCE_ACCOUNT_ID = 777001;
const COMPLIANCE_ADDRESS = '0xBB922dB5F637aAfdc54b1509b231cc07461fb608';
const OTHER_ACCOUNT_ID = 111222;
const OTHER_ACCOUNT_NAME = 'Other Cleared Staff';

let BackfillComplianceAndDebugStaffVerifiedNames: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('BackfillComplianceAndDebugStaffVerifiedNames migration (SQL content)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackfillComplianceAndDebugStaffVerifiedNames = require('../../../../../../../migration/1785742000000-BackfillComplianceAndDebugStaffVerifiedNames');
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

      await new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner as unknown as QueryRunner);

      expect(queryRunner.query).not.toHaveBeenCalled();
    },
  );

  it.each([[undefined], [''], ['   ']])(
    'fails before issuing SQL when the PRD deployment variable is %p',
    async (staffName) => {
      process.env.ENVIRONMENT = 'prd';
      setEnv(STAFF_NAME_ENV, staffName);
      const queryRunner = { query: jest.fn(async (_sql: string) => []) };

      await expect(
        new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner as unknown as QueryRunner),
      ).rejects.toThrow(`${STAFF_NAME_ENV} is required`);
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
        .mockResolvedValueOnce([{ debugCleared: 1, complianceCleared: 1 }]),
    };

    await new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(2);
    const [sql, parameters] = queryRunner.query.mock.calls[0];
    expect(parameters[0]).toBe('Test Staff Name');
    expect(parameters[2]).toBe(COMPLIANCE_ADDRESS);
    expect(sql).toContain('INSERT INTO "log"');
    expect(sql).toContain("'StaffVerifiedNameBackfill'");
    expect(sql).toContain("'previousVerifiedName'");
    expect(sql).toContain("'nextVerifiedName'");
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "audit")');
    expect(sql).toContain('SET "verifiedName" = $1::varchar, "updated" = now()');
    expect(sql).toContain(String(DEBUG_ACCOUNT_ID));
    // The address reaches the SQL only as a parameter, and the match must not hinge on the EIP-55
    // casing the app rendered when the address was transcribed.
    expect(sql).not.toContain(COMPLIANCE_ADDRESS);
    expect(sql).toContain('LOWER("address") = LOWER($3::varchar)');
    expect(sql).not.toContain('Test Staff Name');

    // The precondition must be the exact negation of the postcondition — otherwise a present-but-blank
    // name is a state the update refuses to repair and the assertion refuses to accept, and the deploy
    // dies on a row the migration itself could have repaired.
    expect(sql).toContain("BTRIM(COALESCE(\"verifiedName\", ''), $2::varchar) = ''");
    expect(sql).toContain("'action', CASE WHEN \"needsBackfill\" THEN 'backfilled' ELSE 'keptExistingName' END");

    const [postconditionSql, postconditionParameters] = queryRunner.query.mock.calls[1];
    expect(postconditionSql).toContain('AS "debugCleared"');
    expect(postconditionSql).toContain('AS "complianceCleared"');
    expect(postconditionSql).toContain('BTRIM("verifiedName", $1::varchar)');
    expect(postconditionSql).toContain('LOWER("address") = LOWER($2::varchar)');
    // The postcondition asserts the clearance predicate, not equality with the supplied name.
    expect(postconditionSql).not.toContain('"verifiedName" = $');
    expect(postconditionParameters[0]).toBe(parameters[1]);
    expect(postconditionParameters[1]).toBe(COMPLIANCE_ADDRESS);
  });

  it.each([
    [{ debugCleared: 0, complianceCleared: 1 }],
    [{ debugCleared: 1, complianceCleared: 0 }],
    [{ debugCleared: 0, complianceCleared: 0 }],
  ])('rejects when an account does not reach the cleared state (%o)', async (counts) => {
    process.env.ENVIRONMENT = 'prd';
    process.env[STAFF_NAME_ENV] = 'Test Staff Name';
    const queryRunner = {
      query: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([counts]),
    };

    await expect(
      new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner as unknown as QueryRunner),
    ).rejects.toThrow('did not reach the required state for both staff accounts');
  });

  it('down() deliberately performs no rollback', async () => {
    const migration = new BackfillComplianceAndDebugStaffVerifiedNames();

    expect(migration.down).toHaveLength(0);
    await expect(migration.down()).resolves.toBeUndefined();
  });
});

describeDb('BackfillComplianceAndDebugStaffVerifiedNames migration (real Postgres)', () => {
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BackfillComplianceAndDebugStaffVerifiedNames = require('../../../../../../../migration/1785742000000-BackfillComplianceAndDebugStaffVerifiedNames');
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
        "address" varchar(256) NOT NULL,
        "userDataId" integer NOT NULL
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
  // count it too, so the per-account assertions only hold while they stay pinned to their targets.
  async function insertAccounts(
    debugName: string | null = null,
    complianceName: string | null = null,
    complianceAddress: string = COMPLIANCE_ADDRESS,
  ): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "user_data" ("id", "updated", "verifiedName")
       VALUES (${DEBUG_ACCOUNT_ID}, TIMESTAMP '2000-01-01', $1),
              (${COMPLIANCE_ACCOUNT_ID}, TIMESTAMP '2000-01-01', $2),
              (${OTHER_ACCOUNT_ID}, TIMESTAMP '2000-01-01', $3)`,
      [debugName, complianceName, OTHER_ACCOUNT_NAME],
    );
    await queryRunner.query(
      `INSERT INTO "user" ("address", "userDataId")
       VALUES ($1, ${COMPLIANCE_ACCOUNT_ID}), ('0x0000000000000000000000000000000000000001', ${OTHER_ACCOUNT_ID})`,
      [complianceAddress],
    );
  }

  async function readAccounts(): Promise<{ id: number; verifiedName: string | null }[]> {
    return queryRunner.query(`SELECT "id", "verifiedName" FROM "user_data" ORDER BY "id"`);
  }

  it('backfills both targets, updates their timestamps, and records one before/after audit row', async () => {
    await insertAccounts();

    await new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner);

    const users = (await queryRunner.query(
      `SELECT "id", "verifiedName", "updated" > TIMESTAMP '2000-01-01' AS "wasUpdated"
       FROM "user_data" ORDER BY "id"`,
    )) as { id: number; verifiedName: string | null; wasUpdated: boolean }[];
    expect(users).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME, wasUpdated: false },
      { id: DEBUG_ACCOUNT_ID, verifiedName: 'Test Staff Name', wasUpdated: true },
      { id: COMPLIANCE_ACCOUNT_ID, verifiedName: 'Test Staff Name', wasUpdated: true },
    ]);

    const logs = (await queryRunner.query(
      `SELECT "message" FROM "log" WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId: DEBUG_ACCOUNT_ID,
        previousVerifiedName: null,
        nextVerifiedName: 'Test Staff Name',
        action: 'backfilled',
      },
      {
        userDataId: COMPLIANCE_ACCOUNT_ID,
        previousVerifiedName: null,
        nextVerifiedName: 'Test Staff Name',
        action: 'backfilled',
      },
    ]);
  });

  it('is idempotent and does not append another audit row on a second run', async () => {
    await insertAccounts();
    const migration = new BackfillComplianceAndDebugStaffVerifiedNames();

    await migration.up(queryRunner);
    await migration.up(queryRunner);

    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as { count: number }[];
    expect(logCount[0].count).toBe(1);
    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: DEBUG_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
      { id: COMPLIANCE_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
  });

  it('resolves the compliance account no matter which casing of the address is stored', async () => {
    await insertAccounts(null, null, COMPLIANCE_ADDRESS.toLowerCase());

    await new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner);

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: DEBUG_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
      { id: COMPLIANCE_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
  });

  // `BlankChars` is defined as every character `String.prototype.trim()` strips, so derive that set from
  // the runtime instead of restating it, and assert the migration's duplicated copy repairs a name built
  // from all of them at once. A copy that lost a code point — the drift the migration's own comment warns
  // about — would leave such a name unrepaired and still report success, because the postcondition
  // shares the drifted constant and reads the residual character as non-blank. The migration cannot
  // self-detect this; that is why the test asserts the repaired state rather than a rejection.
  it('repairs a name built from every character trim() strips, pinning the duplicated BlankChars', async () => {
    const blankChars = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter(
      (char) => char.trim() === '',
    );
    expect(blankChars.length).toBeGreaterThan(20); // sanity: the derivation actually found them
    await insertAccounts(blankChars.join(''), blankChars.join(''));

    await new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner);

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: DEBUG_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
      { id: COMPLIANCE_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
  });

  // A blank name clears no account — the gate's predicate is BTRIM-based, not IS NOT NULL. Repairing it
  // is the whole point of widening the precondition: a name of a single tab would otherwise be a row the
  // migration refuses to fix and then refuses to accept, taking the boot down with it.
  it.each([['\t'], ['   '], ['\u00a0'], ['\ufeff']])('repairs a blank verifiedName (%j)', async (blank) => {
    await insertAccounts(blank, blank);

    await new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner);

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: DEBUG_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
      { id: COMPLIANCE_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
  });

  // An identity-verified path may have written a different, valid name to one of the accounts. That
  // account is cleared, so the migration must leave it alone and must NOT fail the deploy — but the
  // divergence between the reviewed value and the deployed one must not be silent. The other account
  // still gets repaired in the same run.
  it('keeps an existing verified name, repairs the other account, and records both actions', async () => {
    await insertAccounts(null, 'Existing Verified Name');

    await expect(new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner)).resolves.toBeUndefined();

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: DEBUG_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
      { id: COMPLIANCE_ACCOUNT_ID, verifiedName: 'Existing Verified Name' },
    ]);
    const logs = (await queryRunner.query(`SELECT "message" FROM "log"`)) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId: DEBUG_ACCOUNT_ID,
        previousVerifiedName: null,
        nextVerifiedName: 'Test Staff Name',
        action: 'backfilled',
      },
      {
        userDataId: COMPLIANCE_ACCOUNT_ID,
        previousVerifiedName: 'Existing Verified Name',
        nextVerifiedName: 'Existing Verified Name',
        action: 'keptExistingName',
      },
    ]);
  });

  // One target present, one absent: the migration repairs the half it can reach, then the per-account
  // postcondition throws over the missing one. Read INSIDE the transaction — the partial repair and its
  // audit row are visible there, and it is exactly this state that the surrounding 'all'-mode
  // transaction discards on PRD. After the rollback the same assertions would hold vacuously.
  it('rejects when no user row carries the compliance address; the partial debug repair never commits', async () => {
    await queryRunner.query(
      `INSERT INTO "user_data" ("id", "verifiedName")
       VALUES (${DEBUG_ACCOUNT_ID}, NULL), (${OTHER_ACCOUNT_ID}, $1)`,
      [OTHER_ACCOUNT_NAME],
    );
    await queryRunner.startTransaction();

    await expect(new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner)).rejects.toThrow(
      'did not reach the required state for both staff accounts',
    );

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: DEBUG_ACCOUNT_ID, verifiedName: 'Test Staff Name' },
    ]);
    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as { count: number }[];
    expect(logCount[0].count).toBe(1);

    await queryRunner.rollbackTransaction();
  });

  it('rejects when the debug account row is absent; the partial compliance repair never commits', async () => {
    await queryRunner.query(`INSERT INTO "user_data" ("id", "verifiedName") VALUES (${COMPLIANCE_ACCOUNT_ID}, NULL)`);
    await queryRunner.query(`INSERT INTO "user" ("address", "userDataId") VALUES ($1, ${COMPLIANCE_ACCOUNT_ID})`, [
      COMPLIANCE_ADDRESS,
    ]);
    await queryRunner.startTransaction();

    await expect(new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner)).rejects.toThrow(
      'did not reach the required state for both staff accounts',
    );

    expect(await readAccounts()).toEqual([{ id: COMPLIANCE_ACCOUNT_ID, verifiedName: 'Test Staff Name' }]);

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

    await expect(new BackfillComplianceAndDebugStaffVerifiedNames().up(queryRunner)).rejects.toThrow(
      'did not reach the required state for both staff accounts',
    );

    expect(await readAccounts()).toEqual([
      { id: OTHER_ACCOUNT_ID, verifiedName: OTHER_ACCOUNT_NAME },
      { id: DEBUG_ACCOUNT_ID, verifiedName: null },
      { id: COMPLIANCE_ACCOUNT_ID, verifiedName: null },
    ]);
    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as { count: number }[];
    expect(logCount[0].count).toBe(0);
  });
});
