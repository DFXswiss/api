import { DataSource, QueryRunner } from 'typeorm';
import { Environment } from 'src/config/config';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'grant_support_role_on_dev_spec';

const TARGET_ADDRESS = '0xA6a045551b210781D98725e9274af419f0602f72';
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';
const STAFF_NAME_ENV = 'STAFF_VERIFIED_NAME_DEV_SUPPORT';
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
    'up() throws before any SQL when STAFF_VERIFIED_NAME_DEV_SUPPORT is %p on dev',
    async (staffName) => {
      process.env.ENVIRONMENT = 'dev';
      setEnv(STAFF_NAME_ENV, staffName);
      const migration = new GrantSupportRoleOnDev();
      const queryRunner = { query: jest.fn(async (_sql: string) => []) };

      await expect(migration.up(queryRunner as unknown as QueryRunner)).rejects.toThrow(
        'STAFF_VERIFIED_NAME_DEV_SUPPORT is required for the DEV staff-name backfill',
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

    const [roleSql, roleParams] = calls[2];
    expect(calls[2]).toHaveLength(2);
    expect(roleParams?.[0]).toBe(TARGET_ADDRESS);
    const normalized = normalizeSql(roleSql);
    expect(roleSql).toContain(`SET "role" = 'Support'`);
    expect(roleSql).toContain('WITH "affected" AS (');
    // AND-conjunction pinned as one fragment so OR-mutants fail (not three separate toContain).
    expect(normalized).toContain(
      normalizeSql(
        `LOWER("address") = LOWER($1::varchar)
                  AND "role" = 'User'`,
      ),
    );
    // Column list pinned as one fragment so dropping only "created" or only "updated" fails.
    expect(roleSql).toContain(
      `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message", "category")`,
    );
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
      expect(call).toHaveLength(2);
    }

    const [sql, params] = calls[0];
    expect(params?.[0]).toBe(TARGET_ADDRESS);
    const normalized = normalizeSql(sql);

    expect(sql).toContain(`SET "role" = 'User'`);
    expect(sql).toContain('WITH "affected" AS (');
    // AND-conjunction pinned as one fragment so OR-mutants fail (not three separate toContain).
    expect(normalized).toContain(
      normalizeSql(
        `LOWER("address") = LOWER($1::varchar)
                  AND "role" = 'Support'`,
      ),
    );
    // Single contiguous fragment pins id membership against up() audit userIds, the OFFSET 0
    // optimizer-fence, and the affectedCount > 0 filter; dropping any piece fails this assertion.
    expect(normalized).toContain(
      normalizeSql(
        `"id"::text = ANY (
                      SELECT UNNEST(string_to_array("audited"."message"::jsonb ->> 'userIds', ','))
                      FROM (
                          SELECT "message" FROM "log"
                          WHERE "system" = 'User'
                            AND "subsystem" = 'GrantSupportRoleOnDev'
                            AND "category" = 'up'
                          OFFSET 0
                      ) "audited"
                      WHERE ("audited"."message"::jsonb ->> 'affectedCount')::int > 0
                  )`,
      ),
    );
    // Column list pinned as one fragment so dropping only "created" or only "updated" fails.
    expect(sql).toContain(
      `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message", "category")`,
    );
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

  /** Default verifiedName matches STAFF_VERIFIED_NAME_DEV_SUPPORT so clearance is a true no-op (no audit row). */
  async function insertUser(
    address: string,
    role: string,
    verifiedName: string | null = TEST_NAME,
  ): Promise<{ userId: number; userDataId: number }> {
    const udRows = await queryRunner.query(`INSERT INTO "user_data" ("verifiedName") VALUES ($1) RETURNING "id"`, [
      verifiedName,
    ]);
    const userDataId = udRows[0].id as number;
    const userId = await insertUserOnUserData(address, role, userDataId);
    return { userId, userDataId };
  }

  async function insertUserOnUserData(address: string, role: string, userDataId: number): Promise<number> {
    const rows = await queryRunner.query(
      `INSERT INTO "user" ("address", "role", "userDataId") VALUES ($1, $2, $3) RETURNING "id"`,
      [address, role, userDataId],
    );
    return rows[0].id as number;
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
    // verifiedName already matches STAFF_VERIFIED_NAME_DEV_SUPPORT → clearance is a true no-op (no audit row).
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

  it('up() promotes every case-variant of the target address on the same user_data and audits all of them', async () => {
    // Unique on "address" is case-sensitive; LOWER() in up() can match multiple user rows.
    // Both variants share one user_data so targetCount stays 1 (exactly-one clearance assertion).
    const { userId: mixedCaseId, userDataId } = await insertUser(TARGET_ADDRESS, 'User');
    const lowerCaseId = await insertUserOnUserData(TARGET_ADDRESS.toLowerCase(), 'User', userDataId);
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

  // Foreign user_data must stay untouched: without `ud."id" = t."id"` the clearance UPDATE becomes a
  // cross product and stamps verifiedName onto every user_data row in the database.
  it('up() leaves foreign user_data verifiedName untouched and audits only the target userDataId', async () => {
    const { userDataId: targetUserDataId } = await insertUser(TARGET_ADDRESS, 'User', null);
    const { userDataId: foreignUserDataId } = await insertUser(OTHER_ADDRESS, 'User', null);
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getVerifiedName(targetUserDataId)).toBe(TEST_NAME);
    expect(await getVerifiedName(foreignUserDataId)).toBeNull();

    const logs = (await queryRunner.query(
      `SELECT "message" FROM "log"
       WHERE "system" = 'User' AND "subsystem" = 'StaffVerifiedNameBackfill'`,
    )) as { message: string }[];
    expect(logs).toHaveLength(1);
    const entries = JSON.parse(logs[0].message) as { userDataId: number }[];
    expect(entries).toHaveLength(1);
    expect(entries[0].userDataId).toBe(targetUserDataId);
  });

  // Two different accounts behind address casings: targetCount > 1 must fail closed. Clearance writes
  // run before the postcondition; wrap in a transaction so the assert reads the production outcome
  // (migrationsTransactionMode 'all' discards the partial repair on throw). Role grant never runs.
  it('up() throws when two different user_data sit behind address case-variants', async () => {
    const { userId: mixedCaseId, userDataId: mixedCaseUserDataId } = await insertUser(TARGET_ADDRESS, 'User', null);
    const { userId: lowerCaseId, userDataId: lowerCaseUserDataId } = await insertUser(
      TARGET_ADDRESS.toLowerCase(),
      'User',
      null,
    );
    const migration = new GrantSupportRoleOnDev();

    await queryRunner.startTransaction();
    await expect(migration.up(queryRunner)).rejects.toThrow(
      'DEV staff-name backfill did not reach the required state for the Support account',
    );
    // Role grant is after the postcondition — never runs, even inside the open transaction.
    expect(await getRole(mixedCaseId)).toBe('User');
    expect(await getRole(lowerCaseId)).toBe('User');
    await queryRunner.rollbackTransaction();

    // After rollback the clearance writes are gone — same as a failed DEV boot migration batch.
    expect(await getVerifiedName(mixedCaseUserDataId)).toBeNull();
    expect(await getVerifiedName(lowerCaseUserDataId)).toBeNull();
  });

  // `BlankChars` is defined as every character `String.prototype.trim()` strips, so derive that set from
  // the runtime instead of restating it, and assert the migration's duplicated copy repairs a name built
  // from all of them at once. A copy that lost a code point — the drift the migration's own comment warns
  // about — would leave such a name unrepaired and still report success, because the postcondition
  // shares the drifted constant and reads the residual character as non-blank. The migration cannot
  // self-detect this; that is why the test asserts the repaired state rather than a rejection.
  it('up() repairs a name built from every character trim() strips, pinning the duplicated BlankChars', async () => {
    const blankChars = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code)).filter(
      (char) => char.trim() === '',
    );
    expect(blankChars.length).toBeGreaterThan(20); // sanity: the derivation actually found them
    const blankName = blankChars.join('');
    const { userDataId } = await insertUser(TARGET_ADDRESS, 'User', blankName);
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
        previousVerifiedName: blankName,
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

  it('up() throws and writes nothing when STAFF_VERIFIED_NAME_DEV_SUPPORT is missing on dev', async () => {
    const { userId, userDataId } = await insertUser(TARGET_ADDRESS, 'User', null);
    setEnv(STAFF_NAME_ENV, undefined);
    const migration = new GrantSupportRoleOnDev();

    await expect(migration.up(queryRunner)).rejects.toThrow(
      'STAFF_VERIFIED_NAME_DEV_SUPPORT is required for the DEV staff-name backfill',
    );

    expect(await getRole(userId)).toBe('User');
    expect(await getVerifiedName(userDataId)).toBeNull();
    const logs = await getLogs();
    expect(logs).toHaveLength(0);
  });

  // Dangling userDataId is production-impossible (NOT NULL + FK) but keeps the postcondition's
  // targetCount = 0 path covered when a user row exists without a matching user_data.
  it('up() throws when a user row has no matching user_data behind the address', async () => {
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

  it('up() throws when no user row sits behind the address', async () => {
    const migration = new GrantSupportRoleOnDev();

    await expect(migration.up(queryRunner)).rejects.toThrow(
      'DEV staff-name backfill did not reach the required state for the Support account',
    );

    const users = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "user"`)) as { count: number }[];
    expect(users[0].count).toBe(0);
    const logs = await getLogs();
    expect(logs).toHaveLength(0);
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

  // down() must demote only ids recorded in the up() audit — not every Support row that matches
  // the address by LOWER(). A pre-existing Support case-variant on the same user_data stays Support.
  it('down() leaves a pre-existing Support case-variant untouched after promoting a sibling User', async () => {
    const { userId: alreadySupportId, userDataId } = await insertUser(TARGET_ADDRESS, 'Support');
    const promotedId = await insertUserOnUserData(TARGET_ADDRESS.toLowerCase(), 'User', userDataId);
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);
    expect(await getRole(alreadySupportId)).toBe('Support');
    expect(await getRole(promotedId)).toBe('Support');

    await migration.down(queryRunner);
    expect(await getRole(alreadySupportId)).toBe('Support');
    expect(await getRole(promotedId)).toBe('User');
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
