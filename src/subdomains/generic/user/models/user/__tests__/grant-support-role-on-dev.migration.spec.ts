import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'grant_support_role_on_dev_spec';

const TARGET_ADDRESS = '0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8';
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';

const NON_DEV_ENVIRONMENTS: (string | undefined)[] = ['prd', 'stg', 'loc', '', undefined];

function setEnvironment(value: string | undefined): void {
  if (value === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = value;
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
  });

  it.each(NON_DEV_ENVIRONMENTS)('up() issues no queries when ENVIRONMENT is %p (not dev)', async (value) => {
    setEnvironment(value);
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

  it('up() grants Support only for the target address currently in User role on dev', async () => {
    process.env.ENVIRONMENT = 'dev';
    const migration = new GrantSupportRoleOnDev();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls).toHaveLength(1);
    for (const call of calls) {
      expect(call).toHaveLength(1);
    }

    const sql = calls[0][0];
    const normalized = normalizeSql(sql);

    expect(sql).toContain(`SET "role" = 'Support'`);
    // AND-conjunction pinned as one fragment so OR-mutants fail (not three separate toContain).
    expect(normalized).toContain(
      normalizeSql(
        `LOWER("address") = LOWER('${TARGET_ADDRESS}')
                  AND "role" = 'User'`,
      ),
    );
    expect(sql).toContain(`INSERT INTO "log"`);
    expect(sql).toContain(`'GrantSupportRoleOnDev'`);
    expect(sql).toContain(`'direction', 'up'`);
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
    expect(sql).toContain(`("message"::jsonb ->> 'affectedCount')::int > 0`);
    expect(sql).toContain(`INSERT INTO "log"`);
    expect(sql).toContain(`'direction', 'down'`);
  });
});

describeDb('GrantSupportRoleOnDev migration (real Postgres)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const originalEnv = process.env.ENVIRONMENT;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GrantSupportRoleOnDev = require('../../../../../../../migration/1785950000000-GrantSupportRoleOnDev');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    process.env.ENVIRONMENT = 'dev';
    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.query(`CREATE SCHEMA "${SCHEMA}"`);
    await queryRunner.query(`SET search_path TO "${SCHEMA}"`);

    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" SERIAL PRIMARY KEY,
        "address" varchar(256),
        "role" varchar(256) NOT NULL
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
    if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
    await queryRunner.query(`SET search_path TO public`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await queryRunner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  async function insertUser(address: string, role: string): Promise<number> {
    const rows = await queryRunner.query(`INSERT INTO "user" ("address", "role") VALUES ($1, $2) RETURNING "id"`, [
      address,
      role,
    ]);
    return rows[0].id as number;
  }

  async function getRole(id: number): Promise<string> {
    const rows = await queryRunner.query(`SELECT "role" FROM "user" WHERE "id" = $1`, [id]);
    return rows[0].role as string;
  }

  async function getLogs(): Promise<
    { system: string; subsystem: string; severity: string; message: string; category: string }[]
  > {
    return queryRunner.query(
      `SELECT "system", "subsystem", "severity", "message", "category" FROM "log" ORDER BY "id"`,
    );
  }

  it('up() promotes the target User address to Support and leaves other User addresses alone', async () => {
    const targetId = await insertUser(TARGET_ADDRESS, 'User');
    const otherId = await insertUser(OTHER_ADDRESS, 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getRole(targetId)).toBe('Support');
    expect(await getRole(otherId)).toBe('User');
  });

  it('up() leaves the target address with Compliance role untouched', async () => {
    const targetId = await insertUser(TARGET_ADDRESS, 'Compliance');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getRole(targetId)).toBe('Compliance');
  });

  it('up() writes exactly one log row with correct affectedCount', async () => {
    const targetId = await insertUser(TARGET_ADDRESS, 'User');
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
    const targetId = await insertUser(TARGET_ADDRESS, 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);
    expect(await getRole(targetId)).toBe('Support');

    await migration.down(queryRunner);
    expect(await getRole(targetId)).toBe('User');
  });

  it('down() without a prior promoting up() leaves an existing Support role untouched', async () => {
    const targetId = await insertUser(TARGET_ADDRESS, 'Support');
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
    const targetId = await insertUser(TARGET_ADDRESS.toLowerCase(), 'User');
    const migration = new GrantSupportRoleOnDev();

    await migration.up(queryRunner);

    expect(await getRole(targetId)).toBe('Support');
  });
});
