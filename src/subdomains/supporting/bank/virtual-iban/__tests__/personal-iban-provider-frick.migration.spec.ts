import { QueryRunner } from 'typeorm';

let AddPersonalIbanProviderFrick: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};
let AddVirtualIbanLifecycleEvent: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('AddPersonalIbanProviderFrick migration', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddPersonalIbanProviderFrick = require('../../../../../../migration/1784878282365-AddPersonalIbanProviderFrick');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddVirtualIbanLifecycleEvent = require('../../../../../../migration/1785100000000-AddVirtualIbanLifecycleEvent');
  });

  it('adds scalar request IDs and a crash-recovery intent without any foreign key or virtual_iban uniqueness change', async () => {
    const queryRunner = { query: jest.fn(async (_statement: string) => undefined) };
    await new AddPersonalIbanProviderFrick().up(queryRunner as unknown as QueryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(`ALTER TABLE "transaction_request" ADD "bankId" integer`);
    expect(sql).toContain(`ALTER TABLE "transaction_request" ADD "virtualIbanId" integer`);
    expect(sql).toContain(`CREATE TABLE "virtual_iban_issuance_intent"`);
    expect(sql).toContain(`CREATE UNIQUE INDEX "IDX_b2192a6137c2bf4227da3fad6f"`);
    expect(sql).toContain(`UNIQUE ("requestReference")`);
    expect(sql).toContain(`CREATE TABLE "virtual_iban_issuance_event"`);
    expect(sql).toContain(`"previousStatus" character varying(32) NOT NULL`);
    expect(sql).toContain(`"nextError" text`);
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
    expect(sql).not.toMatch(/ALTER TABLE "virtual_iban"/i);
  });

  it('drops every added index, table, and column in dependency-safe order', async () => {
    const queryRunner = {
      query: jest.fn(async (statement: string) => (statement.includes('SELECT (') ? [{ cnt: 0 }] : undefined)),
    };
    await new AddPersonalIbanProviderFrick().down(queryRunner as unknown as QueryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(`DROP TABLE "virtual_iban_issuance_intent"`);
    expect(sql).toContain(`ALTER TABLE "transaction_request" DROP COLUMN "virtualIbanId"`);
    expect(sql).toContain(`ALTER TABLE "transaction_request" DROP COLUMN "bankId"`);
    expect(sql.indexOf(`DROP TABLE "virtual_iban_issuance_event"`)).toBeLessThan(
      sql.indexOf(`DROP TABLE "virtual_iban_issuance_intent"`),
    );
  });

  it('refuses rollback before any destructive statement when persisted issuance or routing data exists', async () => {
    const queryRunner = {
      query: jest.fn(async (statement: string) => (statement.includes('SELECT (') ? [{ cnt: 1 }] : undefined)),
    };

    await expect(new AddPersonalIbanProviderFrick().down(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      'refusing to destroy 1 persisted issuance/history/routing value',
    );

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(`count(*) FROM "virtual_iban_issuance_event"`);
    expect(sql).toContain(`count(*) FROM "virtual_iban_issuance_intent"`);
    expect(sql).toContain(`"virtualIbanId" IS NOT NULL`);
    expect(sql).toContain(`"bankId" IS NOT NULL`);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it('adds append-only lifecycle history and before/after issuance owners without foreign keys', async () => {
    const queryRunner = { query: jest.fn(async (_statement: string) => undefined) };

    await new AddVirtualIbanLifecycleEvent().up(queryRunner as unknown as QueryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(`CREATE TABLE "virtual_iban_lifecycle_event"`);
    expect(sql).toContain(`"previousUserDataId" integer NOT NULL`);
    expect(sql).toContain(`"nextUserDataId" integer NOT NULL`);
    expect(sql).toContain(`"reason" text NOT NULL`);
    expect(sql).toContain(`ALTER TABLE "virtual_iban_issuance_event" ADD "previousUserDataId" integer`);
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
  });

  it('refuses lifecycle rollback before dropping append-only history', async () => {
    const queryRunner = {
      query: jest.fn(async (statement: string) => (statement.includes('SELECT (') ? [{ cnt: 2 }] : undefined)),
    };

    await expect(new AddVirtualIbanLifecycleEvent().down(queryRunner as unknown as QueryRunner)).rejects.toThrow(
      'refusing to destroy 2 append-only audit row',
    );

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });
});
