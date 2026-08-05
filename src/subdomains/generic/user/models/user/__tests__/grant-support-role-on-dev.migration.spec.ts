import { DataSource, QueryRunner } from 'typeorm';
import { Environment } from 'src/config/config';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'grant_support_role_on_dev_spec';

const TARGET_ADDRESS = '0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8';
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';
const STAFF_NAME_ENV = 'n_dev_support';
const TEST_NAME = 'Test Name';
const OTHER_NAME = 'Other Name';

// Real non-dev enum values plus deliberately invalid ones: both groups must fail-closed
// (no queries) when ENVIRONMENT is not exactly 'dev'.
const NON_DEV_ENVIRONMENTS: (string | undefined)[] = [
  Environment.PRD,
  Environment.LOC,
  'staging',
  'DEV',
  '',
  undefined,
];

function setEnvironment(value: string | undefined): void {
  if (value === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = value;
}

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

let GrantSupportRoleOnDev: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('GrantSupportRoleOnDev migration (SQL content)', () => {
  const originalEnv = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GrantSupportRoleOnDev = require('../../../../../../../migration/1785950000000-GrantSupportRoleOnDev');
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnv;
    }
    setEnv(STAFF_NAME_ENV, originalStaffName);
  });

  it.each(NON_DEV_ENVIRONMENTS)('up() issues no queries when ENVIRONMENT is %p (not dev)', async (value) => {
    setEnvironment(value);
    setEnv(STAFF_NAME_ENV, undefined);
    const migration = new GrantSupportRoleOnDev();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query.mock.calls).toHaveLength(0);
  });

  it.each(NON_DEV_ENVIRONMENTS)('down() issues no queries when ENVIRONMENT is %p (not dev)', async (value) => {
    setEnvironment(value);
    const migration = new GrantSupportRoleOnDev();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.down(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query.mock.calls).toHaveLength(0);
  });

  it.each([[undefined], [''], ['   ']])(
    'up() throws before any SQL when n_dev_support is %p on dev',
    async (staffName) => {
      process.env.ENVIRONMENT = 'dev';
      setEnv(STAFF_NAME_ENV, staffName);
      const migration = new GrantSupportRoleOnDev();
      const queryRunner = { query: jest.fn(async (_sql: string) => []) };

      await expect(migration.up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
        'n_dev_support is required for the DEV staff-name backfill',
      );
      expect(queryRunner.query.mock.calls).toHaveLength(0);
    },
  );

  it('up() backfills clearance then grants Support only for the target User address on dev', async () => {
    process.env.ENVIRONMENT = 'dev';
    process.env[STAFF_NAME_ENV] = `  ${TEST_NAME}  `;
    const migration = new GrantSupportRoleOnDev();
    const queryRunner = {
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ targetCount: 1, blankCount: 0 }])
        .mockResolvedValueOnce([]),
    };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls).toHaveLength(3);

    const [clearanceSql, clearanceParams] = calls[0];
    expect(clearanceParams?.[0]).toBe(TEST_NAME);
    expect(clearanceParams?.[2]).toBe(TARGET_ADDRESS);
    expect(clearanceSql).toContain('INSERT INTO "log"');
    expect(clearanceSql).toContain("'StaffVerifiedNameBackfill'");
    expect(clearanceSql).toContain("'previousVerifiedName'");
    expect(clearanceSql).toContain("'nextVerifiedName'");
    expect(clearanceSql).toContain('FOR UPDATE');
    expect(clearanceSql).toContain('EXISTS (SELECT 1 FROM "audit")');
    expect(clearanceSql).toContain('SET "verifiedName" = $1::varchar, "updated" = now()');
    expect(clearanceSql).toContain('LOWER("address") = LOWER($3::varchar)');
    expect(clearanceSql).not.toContain(TEST_NAME);
    // Single contiguous COALESCE fragment: BTRIM("verifiedName", …) = '' without COALESCE must fail.
    expect(clearanceSql).toContain("BTRIM(COALESCE(\"verifiedName\", ''), $2::varchar) = ''");
    expect(clearanceSql).toContain(
      "'action', CASE WHEN \"needsBackfill\" THEN 'backfilled' ELSE 'keptExistingName' END",
    );

    const [postconditionSql, postconditionParams] = calls[1];
    expect(postconditionSql).toContain('AS "targetCount"');
    expect(postconditionSql).toContain('AS "blankCount"');
    expect(postconditionSql).toContain('LOWER("address") = LOWER($2::varchar)');
    expect(postconditionSql).not.toContain('"verifiedName" = $');
    expect(postconditionParams?.[0]).toBe(clearanceParams?.[1]);
    expect(postconditionParams?.[1]).toBe(TARGET_ADDRESS);

    const roleSql = calls[2][0];
    expect(calls[2]).toHaveLength(1);
    const normalized = normalizeSql(roleSql);
    expect(roleSql).toContain(`SET "role" = 'Support'`);
    // AND-conjunction pinned as one fragment so OR-mutants fail (not three separate toContain).
    expect(normalized).toContain(
      normalizeSql(
        `LOWER("address") = LOWER('${TARGET_ADDRESS}')
                  AND "role" = 'User'`,
      ),
    );
    expect(roleSql).toContain(`INSERT INTO "log"`);
    expect(roleSql).toContain(`'GrantSupportRoleOnDev'`);
    expect(roleSql).toContain(`'direction', 'up'`);
  });

  it('down() restores User only for the target address currently in Support role on dev', async () => {
    process.env.ENVIRONMENT = 'dev';
    const migration = new GrantSupportRoleOnDev();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.down(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls).toHaveLength(1);
    for (const call of calls) {
      expect(call).toHaveLength(1);
    }

    const sql = calls[0][0];
    const normalized = normalizeSql(sql);

    expect(sql).toContain(`SET "role" = 'User'`);
    // AND-conjunction pinned as one fragment so OR-mutants fail (not three separate toContain).
    expect(normalized).toContain(
      normalizeSql(
        `LOWER("address") = LOWER('${TARGET_ADDRESS}')
                  AND "role" = 'Support'`,
      ),
    );
    // Single contiguous fragment pins the OFFSET 0 optimizer-fence; reverting the cast
    // into the same WHERE as the filters fails this assertion.
    expect(normalized).toContain(
      normalizeSql(
        `SELECT 1 FROM (
                          SELECT "message" FROM "log"
                          WHERE "system" = 'User'
                            AND "subsystem" = 'GrantSupportRoleOnDev'
                            AND "category" = 'up'
                          OFFSET 0
                      ) "audited"
                      WHERE ("audited"."message"::jsonb ->> 'affectedCount')::int > 0`,
      ),
    );
    expect(sql).toContain(`INSERT INTO "log"`);
    expect(sql).toContain(`'direction', 'down'`);
  });
});

describeDb('GrantSupportRoleOnDev migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const originalEnv = process.env.ENVIRONMENT;
  const originalStaffName = process.env[STAFF_NAME_ENV];

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GrantSupportRoleOnDev = require('../../../../../../../migration/1785950000000-GrantSupportRoleOnDev');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    process.env.ENVIRONMENT = 'dev';
    process.env[STAFF_NAME_ENV] = TEST_NAME;
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    await queryRunner.query(`
      CREATE TABLE "user_data" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "verifiedName" varchar(256)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" SERIAL PRIMARY KEY,
        "address" varchar(256) UNIQUE,
        "role" varchar(256) NOT NULL,
        "userDataId" integer
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "log" (
        "id" SERIAL PRIMARY KEY,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "system" varchar(256) NOT NULL,
        "subsystem" varchar(256) NOT NULL,
        "severity" varchar(256) NOT NULL,
        "message" text NOT NULL,
        "category" varchar(256),
        "valid" boolean
      )
    `);
  });

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnv;
    }
    setEnv(STAFF_NAME_ENV, originalStaffName);
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  /** Default verifiedName matches n_dev_support so clearance is a true no-op (no audit row). */
  async function insertUser(
    address: string,
    role: string,
    verifiedName: string | null = TEST_NAME,
  ): Promise<{ userId: number; userDataId: number }> {
    const udRows = await queryRunner.query(`INSERT INTO "user_data" ("verifiedName") VALUES ($1) RETURNING "id"`, [
      verifiedName,
    ]);
    const userDataId = udRows[0].id as number;
    const rows = await queryRunner.query(
      `INSERT INTO "user" ("address", "role", "userDataId") VALUES ($1, $2, $3) RETURNING "id"`,
      [address, role, userDataId],
    );
    return { userId: rows[0].id as number, userDataId };
  }

  async function getRole(id: number): Promise<string> {
    const rows = await queryRunner.query(`SELECT "role" FROM "user" WHERE "id" = $1`, [id]);
    return rows[0].role as string;
  }

  async function getVerifiedName(userDataId: number): Promise<string | null> {
    const rows = await queryRunner.query(`SELECT "verifiedName" FROM "user_data" WHERE "id" = $1`, [userDataId]);
    return rows[0].verifiedName as string | null;
  }

  async function getLogs(): Promise<
    { system: string; subsystem: string; severity: string; message: string; category: string }[]
  > {
    return queryRunner.query(
      `SELECT "system", "subsystem", "severity", "message", "category" FROM "log" ORDER BY "id"`,
    );
  }

  async function getRoleLogs(): Promise<
    { system: string; subsystem: string; severity: string; message: string; category: string }[]
  > {
    return queryRunner.query(
      `SELECT "system", "subsystem", "severity", "message", "category" FROM "log"
       WHERE "subsystem" = 'GrantSupportRoleOnDev' ORDER BY "id"`,
    );
  }

  it('up() promotes the target User address to Support and leaves other User addresses alone', async () => {
    const { userId: targetId } = await insertUser(TARGET_ADDRESS, 'User');
    const { userId: otherId } = await insertUser(OTHER_ADDRESS, 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getRole(targetId)).toBe('Support');
    expect(await getRole(otherId)).toBe('User');
  });

  it('up() leaves the target address with Compliance role untouched', async () => {
    const { userId: targetId } = await insertUser(TARGET_ADDRESS, 'Compliance');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getRole(targetId)).toBe('Compliance');
  });

  it('up() writes exactly one log row with correct affectedCount', async () => {
    // verifiedName already matches n_dev_support → clearance is a true no-op (no audit row).
    const { userId: targetId } = await insertUser(TARGET_ADDRESS, 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    const logs = await getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].system).toBe('User');
    expect(logs[0].subsystem).toBe('GrantSupportRoleOnDev');
    expect(logs[0].severity).toBe('Info');
    expect(logs[0].category).toBe('up');

    const message = JSON.parse(logs[0].message) as {
      migration: string;
      direction: string;
      affectedCount: number;
      userIds: string;
      fromRole: string;
      toRole: string;
    };
    expect(message.migration).toBe('GrantSupportRoleOnDev1785950000000');
    expect(message.direction).toBe('up');
    expect(Number(message.affectedCount)).toBe(1);
    expect(message.userIds).toBe(String(targetId));
    expect(message.fromRole).toBe('User');
    expect(message.toRole).toBe('Support');
  });

  it('down() after up() restores User', async () => {
    const { userId: targetId } = await insertUser(TARGET_ADDRESS, 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);
    expect(await getRole(targetId)).toBe('Support');

    await migration.down(queryRunner);
    expect(await getRole(targetId)).toBe('User');
  });

  it('down() without a prior promoting up() leaves an existing Support role untouched', async () => {
    const { userId: targetId } = await insertUser(TARGET_ADDRESS, 'Support');
    const migration = new GrantSupportRoleOnDev();

    await migration.down(queryRunner);

    expect(await getRole(targetId)).toBe('Support');

    const logs = await getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].category).toBe('down');
    const message = JSON.parse(logs[0].message) as { affectedCount: number };
    expect(Number(message.affectedCount)).toBe(0);
  });

  it('up() matches the target address case-insensitively', async () => {
    const { userId: targetId } = await insertUser(TARGET_ADDRESS.toLowerCase(), 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getRole(targetId)).toBe('Support');
  });

  it('up() promotes every case-variant of the target address and audits all of them', async () => {
    // Unique on "address" is case-sensitive; LOWER() in up() can match multiple rows.
    const { userId: mixedCaseId } = await insertUser(TARGET_ADDRESS, 'User');
    const { userId: lowerCaseId } = await insertUser(TARGET_ADDRESS.toLowerCase(), 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getRole(mixedCaseId)).toBe('Support');
    expect(await getRole(lowerCaseId)).toBe('Support');

    const logs = await getRoleLogs();
    expect(logs).toHaveLength(1);
    const message = JSON.parse(logs[0].message) as { affectedCount: number; userIds: string };
    expect(Number(message.affectedCount)).toBe(2);
    const userIds = message.userIds.split(',');
    expect(userIds).toContain(String(mixedCaseId));
    expect(userIds).toContain(String(lowerCaseId));
  });

  // Proves the current plan does not cast non-JSON log rows. Does not prove the OFFSET 0
  // fence is required under every plan.
  it('up() and down() succeed when unrelated log rows hold non-JSON messages', async () => {
    const { userId: targetId } = await insertUser(TARGET_ADDRESS, 'User');
    await queryRunner.query(
      `INSERT INTO "log" ("system", "subsystem", "severity", "message", "category")
       VALUES ('Other', 'Whatever', 'Info', 'not json', NULL)`,
    );
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);
    expect(await getRole(targetId)).toBe('Support');

    await migration.down(queryRunner);
    expect(await getRole(targetId)).toBe('User');
  });

  it('up() backfills a NULL verifiedName and writes a StaffVerifiedNameBackfill audit', async () => {
    const { userId, userDataId } = await insertUser(TARGET_ADDRESS, 'User', null);
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getVerifiedName(userDataId)).toBe(TEST_NAME);
    expect(await getRole(userId)).toBe('Support');

    const logs = (await queryRunner.query(
      `SELECT "message" FROM "log"
       WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId,
        previousVerifiedName: null,
        nextVerifiedName: TEST_NAME,
        action: 'backfilled',
      },
    ]);
  });

  it.each([['\t'], ['\u00a0']])('up() repairs a blank-only verifiedName (%j)', async (blank) => {
    const { userDataId } = await insertUser(TARGET_ADDRESS, 'User', blank);
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getVerifiedName(userDataId)).toBe(TEST_NAME);

    const logs = (await queryRunner.query(
      `SELECT "message" FROM "log"
       WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId,
        previousVerifiedName: blank,
        nextVerifiedName: TEST_NAME,
        action: 'backfilled',
      },
    ]);
  });

  it('up() keeps an existing non-blank verifiedName and audits keptExistingName', async () => {
    const { userDataId } = await insertUser(TARGET_ADDRESS, 'User', OTHER_NAME);
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getVerifiedName(userDataId)).toBe(OTHER_NAME);

    const logs = (await queryRunner.query(
      `SELECT "message" FROM "log"
       WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { message: string }[];
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].message)).toEqual([
      {
        userDataId,
        previousVerifiedName: OTHER_NAME,
        nextVerifiedName: OTHER_NAME,
        action: 'keptExistingName',
      },
    ]);
  });

  it('up() throws and writes nothing when n_dev_support is missing on dev', async () => {
    const { userId, userDataId } = await insertUser(TARGET_ADDRESS, 'User', null);
    setEnv(STAFF_NAME_ENV, undefined);
    const migration = new GrantSupportRoleOnDev();

    await expect(migration.up(queryRunner)).rejects.toThrow(
      'n_dev_support is required for the DEV staff-name backfill',
    );

    expect(await getRole(userId)).toBe('User');
    expect(await getVerifiedName(userDataId)).toBeNull();
    const logs = await getLogs();
    expect(logs).toHaveLength(0);
  });

  it('up() throws when no user_data sits behind the address', async () => {
    await queryRunner.query(`INSERT INTO "user" ("address", "role", "userDataId") VALUES ($1, 'User', 99999)`, [
      TARGET_ADDRESS,
    ]);
    const migration = new GrantSupportRoleOnDev();

    await expect(migration.up(queryRunner)).rejects.toThrow(
      'DEV staff-name backfill did not reach the required state for the Support account',
    );

    const role = (await queryRunner.query(`SELECT "role" FROM "user" WHERE "address" = $1`, [TARGET_ADDRESS])) as {
      role: string;
    }[];
    expect(role[0].role).toBe('User');
  });

  // blankCount is always 0 after a normal UPDATE: every targeted row is either repaired or was
  // never blank. The postcondition still guards against DB-side reversion (trigger, concurrent
  // writer, default). This test installs a BEFORE UPDATE trigger that re-blanks verifiedName so
  // the otherwise vacuum-true half of the assertion can fire.
  // Function + trigger are created under SCHEMA (search_path); afterEach's DROP SCHEMA … CASCADE
  // removes them with the rest of the fixture — no leftover across tests.
  it('up() throws when verifiedName stays blank after the backfill (blankCount postcondition)', async () => {
    const { userId } = await insertUser(TARGET_ADDRESS, 'User', null);

    await queryRunner.query(`
      CREATE FUNCTION force_blank_verified_name() RETURNS trigger AS $fn$
      BEGIN
        NEW."verifiedName" := NULL;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER force_blank_verified_name_trigger
      BEFORE UPDATE ON "user_data"
      FOR EACH ROW
      EXECUTE FUNCTION force_blank_verified_name()
    `);

    const migration = new GrantSupportRoleOnDev();

    await expect(migration.up(queryRunner)).rejects.toThrow(
      'DEV staff-name backfill did not reach the required state for the Support account',
    );

    // Role grant is after the postcondition; a blankCount failure must not elevate.
    expect(await getRole(userId)).toBe('User');
  });

  it('down() after up() restores the role but leaves verifiedName set', async () => {
    const { userId, userDataId } = await insertUser(TARGET_ADDRESS, 'User', null);
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);
    expect(await getRole(userId)).toBe('Support');
    expect(await getVerifiedName(userDataId)).toBe(TEST_NAME);

    await migration.down(queryRunner);
    expect(await getRole(userId)).toBe('User');
    expect(await getVerifiedName(userDataId)).toBe(TEST_NAME);
  });

  it('is idempotent: a second up() changes nothing and appends no clearance audit', async () => {
    const { userDataId } = await insertUser(TARGET_ADDRESS, 'User', null);
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);
    await migration.up(queryRunner);

    expect(await getVerifiedName(userDataId)).toBe(TEST_NAME);
    const clearanceLogs = (await queryRunner.query(
      `SELECT count(*)::int AS "count" FROM "log"
       WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { count: number }[];
    expect(clearanceLogs[0].count).toBe(1);
  });
});
