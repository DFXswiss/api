import { QueryRunner } from 'typeorm';

let GrantSupportRoleOnDev: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('GrantSupportRoleOnDev migration (SQL content)', () => {
  const originalEnv = process.env.ENVIRONMENT;

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GrantSupportRoleOnDev = require('../../../../../../../migration/1785311300000-GrantSupportRoleOnDev');
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
    const migration = new GrantSupportRoleOnDev();
    const queryRunner = { query: jest.fn(async (_sql: string) => []) };

    await migration.up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query.mock.calls).toHaveLength(0);
  });

  it('down() issues no queries when ENVIRONMENT is not dev', async () => {
    process.env.ENVIRONMENT = 'prd';
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
    expect(sql).toContain(`SET "role" = 'Support'`);
    expect(sql).toContain(`LOWER("address") = LOWER('0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8')`);
    expect(sql).toContain(`"role" = 'User'`);
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
    expect(sql).toContain(`SET "role" = 'User'`);
    expect(sql).toContain(`LOWER("address") = LOWER('0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8')`);
    expect(sql).toContain(`"role" = 'Support'`);
  });
});
