import { newDb } from 'pg-mem';

let SnapshotFrickReferenceAccount: new () => {
  up(queryRunner: { query(sql: string): Promise<unknown> }): Promise<void>;
};

describe('SnapshotFrickReferenceAccount migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<unknown>, [string]>;
  let migration: InstanceType<typeof SnapshotFrickReferenceAccount>;

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SnapshotFrickReferenceAccount = require('../../../../../../migration/1785300000000-SnapshotFrickReferenceAccount');
  });

  beforeEach(() => {
    db = newDb();
    db.public.none(`
      CREATE TABLE "bank" (
        "id" integer PRIMARY KEY,
        "iban" character varying(256) NOT NULL,
        "receive" boolean NOT NULL
      )
    `);
    db.public.none(`
      CREATE TABLE "virtual_iban_issuance_intent" (
        "id" integer PRIMARY KEY,
        "bankId" integer NOT NULL,
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
    migration = new SnapshotFrickReferenceAccount();
  });

  it('backfills immutable intent and event snapshots and makes every field required', async () => {
    db.public.none(`
      INSERT INTO "bank" ("id", "iban", "receive")
      VALUES (10, 'LI32088110105923K000C', true)
    `);
    db.public.none(`
      INSERT INTO "virtual_iban_issuance_intent" ("id", "bankId", "provider")
      VALUES (20, 10, 'Bank Frick')
    `);
    db.public.none(`
      INSERT INTO "virtual_iban_issuance_event" ("id", "intentId")
      VALUES (30, 20)
    `);

    await migration.up({ query });

    expect(
      db.public.one(
        `SELECT "referenceAccountIban", "referenceAccountReceive"
           FROM "virtual_iban_issuance_intent"
          WHERE "id" = 20`,
      ),
    ).toEqual({ referenceAccountIban: 'LI32088110105923K000C', referenceAccountReceive: true });
    expect(
      db.public.one(
        `SELECT "referenceAccountIban", "referenceAccountReceive"
           FROM "virtual_iban_issuance_event"
          WHERE "id" = 30`,
      ),
    ).toEqual({ referenceAccountIban: 'LI32088110105923K000C', referenceAccountReceive: true });
    expect(() =>
      db.public.none(`
        INSERT INTO "virtual_iban_issuance_event"
          ("id", "intentId", "referenceAccountIban", "referenceAccountReceive")
        VALUES (31, 20, NULL, NULL)
      `),
    ).toThrow();
  });

  it('fails closed when an intent has no resolvable bank instead of inventing a snapshot', async () => {
    db.public.none(`
      INSERT INTO "virtual_iban_issuance_intent" ("id", "bankId", "provider")
      VALUES (20, 999, 'Bank Frick')
    `);

    await expect(migration.up({ query })).rejects.toThrow(
      '1 intent row(s) have no resolvable Bank Frick reference-account snapshot',
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toContain('ALTER COLUMN "referenceAccountIban" SET NOT NULL');
  });
});
