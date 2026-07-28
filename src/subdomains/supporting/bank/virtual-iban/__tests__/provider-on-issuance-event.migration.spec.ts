import { newDb } from 'pg-mem';

let AddProviderToVirtualIbanIssuanceEvent: new () => {
  up(queryRunner: { query(sql: string): Promise<unknown> }): Promise<void>;
};

describe('AddProviderToVirtualIbanIssuanceEvent migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<unknown>, [string]>;
  let migration: InstanceType<typeof AddProviderToVirtualIbanIssuanceEvent>;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddProviderToVirtualIbanIssuanceEvent = require('../../../../../../migration/1785200000000-AddProviderToVirtualIbanIssuanceEvent');
  });

  beforeEach(() => {
    db = newDb();
    db.public.none(`
      CREATE TABLE "virtual_iban_issuance_intent" (
        "id" integer PRIMARY KEY,
        "provider" character varying(256) NOT NULL
      )
    `);
    db.public.none(`
      CREATE TABLE "virtual_iban_issuance_event" (
        "id" integer PRIMARY KEY,
        "intentId" integer NOT NULL
      )
    `);
    query = jest.fn(async (sql: string) => {
      if (/^\s*SET\s+LOCAL\b/i.test(sql)) return;
      if (/^\s*SELECT\b/i.test(sql)) return db.public.many(sql);
      db.public.none(sql);
    });
    migration = new AddProviderToVirtualIbanIssuanceEvent();
  });

  it('backfills each event from its real intent provider and makes the snapshot required', async () => {
    db.public.none(`
      INSERT INTO "virtual_iban_issuance_intent" ("id", "provider")
      VALUES (10, 'Bank Frick'), (20, 'Yapeal')
    `);
    db.public.none(`
      INSERT INTO "virtual_iban_issuance_event" ("id", "intentId")
      VALUES (100, 10), (200, 20)
    `);

    await migration.up({ query });

    expect(db.public.many(`SELECT "id", "provider" FROM "virtual_iban_issuance_event" ORDER BY "id"`)).toEqual([
      { id: 100, provider: 'Bank Frick' },
      { id: 200, provider: 'Yapeal' },
    ]);
    expect(() =>
      db.public.none(`INSERT INTO "virtual_iban_issuance_event" ("id", "intentId", "provider") VALUES (300, 10, NULL)`),
    ).toThrow();
  });

  it('fails before NOT NULL/index creation when an event has no matching intent', async () => {
    db.public.none(`INSERT INTO "virtual_iban_issuance_event" ("id", "intentId") VALUES (100, 999)`);

    await expect(migration.up({ query })).rejects.toThrow('1 event row(s) have no matching issuance intent provider');

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toContain('ALTER COLUMN "provider" SET NOT NULL');
    expect(sql).not.toContain('CREATE INDEX');
  });
});
