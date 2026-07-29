import { QueryRunner } from 'typeorm';

let ClearDevUserSignatures: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(): Promise<void>;
};

describe('ClearDevUserSignatures migration (SQL content)', () => {
  const originalEnv = process.env.ENVIRONMENT;

  beforeAll(() => {
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
