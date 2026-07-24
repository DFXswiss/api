import { QueryRunner } from 'typeorm';

let AddPersonalIbanProviderFrick: new () => {
  up(queryRunner: QueryRunner): Promise<void>;
  down(queryRunner: QueryRunner): Promise<void>;
};

describe('AddPersonalIbanProviderFrick migration', () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddPersonalIbanProviderFrick = require('../../../../../../migration/1784878282365-AddPersonalIbanProviderFrick');
  });

  it('adds scalar request IDs and a crash-recovery intent without any foreign key or virtual_iban uniqueness change', async () => {
    const queryRunner = { query: jest.fn(async () => undefined) };
    await new AddPersonalIbanProviderFrick().up(queryRunner as unknown as QueryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(`ALTER TABLE "transaction_request" ADD "bankId" integer`);
    expect(sql).toContain(`ALTER TABLE "transaction_request" ADD "virtualIbanId" integer`);
    expect(sql).toContain(`CREATE TABLE "virtual_iban_issuance_intent"`);
    expect(sql).toContain(`UNIQUE ("userDataId", "currencyId", "bankId")`);
    expect(sql).toContain(`UNIQUE ("requestReference")`);
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
    expect(sql).not.toMatch(/ALTER TABLE "virtual_iban"/i);
  });

  it('drops every added index, table, and column in dependency-safe order', async () => {
    const queryRunner = { query: jest.fn(async () => undefined) };
    await new AddPersonalIbanProviderFrick().down(queryRunner as unknown as QueryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain(`DROP TABLE "virtual_iban_issuance_intent"`);
    expect(sql).toContain(`ALTER TABLE "transaction_request" DROP COLUMN "virtualIbanId"`);
    expect(sql).toContain(`ALTER TABLE "transaction_request" DROP COLUMN "bankId"`);
    expect(sql.indexOf(`DROP INDEX "public"."IDX_virtual_iban_issuance_intent_bankId"`)).toBeLessThan(
      sql.indexOf(`DROP TABLE "virtual_iban_issuance_intent"`),
    );
  });
});
