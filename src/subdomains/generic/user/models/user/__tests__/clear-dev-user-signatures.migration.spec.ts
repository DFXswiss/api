import { createHash } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';

const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;
const SCHEMA = 'clear_dev_user_signatures_spec';

let ClearDevUserSignatures: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

describe('ClearDevUserSignatures migration (SQL content)', () => {
  const originalEnv = process.env.ENVIRONMENT;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ClearDevUserSignatures = require('../../../../../../../migration/1785500000000-ClearDevUserSignatures');
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENVIRONMENT;
    } else {
      process.env.ENVIRONMENT = originalEnv;
    }
  });

  it('up() issues no queries when ENVIRONMENT is not dev', async () => {
    process.env.ENVIRONMENT = 'prd';
    const migration = new ClearDevUserSignatures();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query.mock.calls).toHaveLength(0);
  });

  it('up() issues the audited rotation statement on dev (SQL content only, not executed)', async () => {
    process.env.ENVIRONMENT = 'dev';
    const migration = new ClearDevUserSignatures();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.up(queryRunner as unknown as QueryRunner);

    const calls = queryRunner.query.mock.calls as [string, unknown[]?][];
    expect(calls).toHaveLength(1);
    for (const call of calls) {
      expect(call).toHaveLength(1);
    }

    const sql = calls[0][0];
    expect(sql).toContain('SET "signature" = NULL');
    expect(sql).toContain('"signature" IS NOT NULL');
    expect(sql).toContain('"user"');
    expect(sql).toContain('INSERT INTO "log"');
    expect(sql).toContain('md5("signature")');
    expect(sql).toContain('DevSignatureRotation');
    expect(sql).toContain('EXISTS (SELECT 1 FROM "audit")');
  });

  it('down() never issues a query (the rotation is deliberately irreversible)', async () => {
    const migration = new ClearDevUserSignatures();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.down();

    expect(queryRunner.query.mock.calls).toHaveLength(0);
  });
});

describeDb('ClearDevUserSignatures migration (real Postgres)', () => {
  const originalEnv = process.env.ENVIRONMENT;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeAll(async () => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ClearDevUserSignatures = require('../../../../../../../migration/1785500000000-ClearDevUserSignatures');
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
        "address" text,
        "signature" text
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

  it('rotates non-null signatures and writes exactly one audit log row with md5 fingerprints', async () => {
    process.env.ENVIRONMENT = 'dev';

    const fp1 = createHash('md5').update('sig-plaintext-1').digest('hex');
    const fp2 = createHash('md5').update('sig-plaintext-2').digest('hex');

    const inserted = (await queryRunner.query(`
      INSERT INTO "user" ("address", "signature")
      VALUES
        ('addr-1', 'sig-plaintext-1'),
        ('addr-2', 'sig-plaintext-2'),
        ('addr-3', NULL)
      RETURNING "id", "address"
    `)) as { id: number; address: string }[];

    const idByAddress = new Map(inserted.map((row) => [row.address, row.id]));
    const id1 = idByAddress.get('addr-1');
    const id2 = idByAddress.get('addr-2');
    const id3 = idByAddress.get('addr-3');

    const migration = new ClearDevUserSignatures();
    await migration.up(queryRunner);

    const users = (await queryRunner.query(`SELECT "id", "signature" FROM "user" ORDER BY "id"`)) as {
      id: number;
      signature: string | null;
    }[];

    expect(users).toHaveLength(3);
    expect(users.find((u) => u.id === id1)?.signature).toBeNull();
    expect(users.find((u) => u.id === id2)?.signature).toBeNull();
    expect(users.find((u) => u.id === id3)?.signature).toBeNull();

    const logs = (await queryRunner.query(
      `SELECT * FROM "log" WHERE "system" = 'User' AND "subsystem" = 'DevSignatureRotation'`,
    )) as { message: string }[];

    expect(logs).toHaveLength(1);

    const entries = JSON.parse(logs[0].message) as {
      id: number;
      beforeFingerprint: string;
      after: null;
    }[];

    expect(entries).toHaveLength(2);

    const entry1 = entries.find((e) => e.id === id1);
    const entry2 = entries.find((e) => e.id === id2);

    expect(entry1).toBeDefined();
    expect(entry1?.beforeFingerprint).toBe(fp1);
    expect(entry1?.after).toBeNull();

    expect(entry2).toBeDefined();
    expect(entry2?.beforeFingerprint).toBe(fp2);
    expect(entry2?.after).toBeNull();
  });

  it('writes no audit row and changes nothing when there are no non-null signatures', async () => {
    process.env.ENVIRONMENT = 'dev';

    await queryRunner.query(`
      INSERT INTO "user" ("address", "signature")
      VALUES ('addr-empty', NULL)
    `);

    const migration = new ClearDevUserSignatures();
    await migration.up(queryRunner);

    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as { count: number }[];
    expect(logCount[0].count).toBe(0);

    const users = (await queryRunner.query(`SELECT "signature" FROM "user" WHERE "address" = 'addr-empty'`)) as {
      signature: string | null;
    }[];
    expect(users).toHaveLength(1);
    expect(users[0].signature).toBeNull();
  });

  it('rolls back and rejects when the audit insert fails, leaving the signature intact', async () => {
    process.env.ENVIRONMENT = 'dev';

    await queryRunner.query(`
      INSERT INTO "user" ("address", "signature")
      VALUES ('addr-fail', 'sig-plaintext-3')
    `);

    await queryRunner.query(`DROP TABLE "log"`);

    const migration = new ClearDevUserSignatures();
    await expect(migration.up(queryRunner)).rejects.toThrow();

    // Failed statement may leave the connection unusable; read committed state via a fresh runner.
    const verifyRunner = dataSource.createQueryRunner();
    await verifyRunner.connect();
    try {
      await verifyRunner.query(`SET search_path TO "${SCHEMA}"`);
      const users = (await verifyRunner.query(`SELECT "signature" FROM "user" WHERE "address" = 'addr-fail'`)) as {
        signature: string | null;
      }[];
      expect(users).toHaveLength(1);
      expect(users[0].signature).toBe('sig-plaintext-3');
    } finally {
      await verifyRunner.release();
    }
  });

  it('does nothing on a real database when ENVIRONMENT is not dev', async () => {
    process.env.ENVIRONMENT = 'prd';

    await queryRunner.query(`
      INSERT INTO "user" ("address", "signature")
      VALUES ('addr-prd', 'sig-plaintext-prd')
    `);

    const migration = new ClearDevUserSignatures();
    await migration.up(queryRunner);

    const users = (await queryRunner.query(`SELECT "signature" FROM "user" WHERE "address" = 'addr-prd'`)) as {
      signature: string | null;
    }[];
    expect(users).toHaveLength(1);
    expect(users[0].signature).toBe('sig-plaintext-prd');

    const logCount = (await queryRunner.query(`SELECT count(*)::int AS "count" FROM "log"`)) as { count: number }[];
    expect(logCount[0].count).toBe(0);
  });
});
