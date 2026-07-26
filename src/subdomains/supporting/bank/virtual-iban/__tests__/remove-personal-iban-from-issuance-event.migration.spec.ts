import { newDb } from 'pg-mem';

let RemovePersonalIbanFromIssuanceEvent: new () => {
  up(queryRunner: { query(sql: string): Promise<unknown> }): Promise<void>;
  down(queryRunner: { query(sql: string): Promise<unknown> }): Promise<void>;
};

describe('RemovePersonalIbanFromIssuanceEvent migration', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<unknown>, [string]>;
  let migration: InstanceType<typeof RemovePersonalIbanFromIssuanceEvent>;

  const matchedIban = 'LI11FAKE0000000000001';
  const orphanIban = 'LI22ORPHAN000000000002';

  beforeAll(() => {
    // The migration is intentionally a plain CommonJS module, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    RemovePersonalIbanFromIssuanceEvent = require('../../../../../../migration/1784995385824-RemovePersonalIbanFromIssuanceEvent');
  });

  beforeEach(() => {
    db = newDb();
    db.public.none(`
      CREATE TABLE "virtual_iban" (
        "id" integer PRIMARY KEY,
        "iban" character varying(34) NOT NULL
      )
    `);
    // Pre-migration shape from 1784878282365-AddPersonalIbanProviderFrick.
    db.public.none(`
      CREATE TABLE "virtual_iban_issuance_event" (
        "id" SERIAL NOT NULL,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "intentId" integer NOT NULL,
        "userDataId" integer NOT NULL,
        "currencyId" integer NOT NULL,
        "bankId" integer NOT NULL,
        "previousStatus" character varying(32) NOT NULL,
        "nextStatus" character varying(32) NOT NULL,
        "previousExternalIban" character varying(34),
        "nextExternalIban" character varying(34),
        "previousError" text,
        "nextError" text,
        CONSTRAINT "PK_test_issuance_event" PRIMARY KEY ("id")
      )
    `);

    query = jest.fn(async (sql: string) => {
      // pg-mem has no session/transaction LOCAL settings; skip like a no-op.
      if (/^\s*SET\s+LOCAL\b/i.test(sql)) return;
      // SELECT must return rows (orphan count check after backfill).
      if (/^\s*SELECT\b/i.test(sql)) {
        return db.public.many(sql);
      }
      db.public.none(sql);
    });
    migration = new RemovePersonalIbanFromIssuanceEvent();
  });

  const insertEvent = (
    id: number,
    previousExternalIban: string | null,
    nextExternalIban: string | null,
  ): void => {
    db.public.none(
      `INSERT INTO "virtual_iban_issuance_event"
        ("id", "intentId", "userDataId", "currencyId", "bankId",
         "previousStatus", "nextStatus", "previousExternalIban", "nextExternalIban",
         "previousError", "nextError")
       VALUES (${id}, 1, 2, 3, 4, 'InFlight', 'Completed',
         ${previousExternalIban == null ? 'NULL' : `'${previousExternalIban}'`},
         ${nextExternalIban == null ? 'NULL' : `'${nextExternalIban}'`},
         NULL, NULL)`,
    );
  };

  const hasColumn = (name: string): boolean => {
    try {
      db.public.none(`SELECT "${name}" FROM "virtual_iban_issuance_event" WHERE false`);
      return true;
    } catch {
      return false;
    }
  };

  it('backfills matching IBAN references and nulls, drops old columns, and never emits FKs', async () => {
    db.public.none(`INSERT INTO "virtual_iban" ("id", "iban") VALUES (42, '${matchedIban}')`);

    insertEvent(1, matchedIban, matchedIban);
    insertEvent(2, null, null);

    await migration.up({ query });

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);

    const rows = db.public.many(
      `SELECT "id", "previousVirtualIbanId", "nextVirtualIbanId"
       FROM "virtual_iban_issuance_event"
       ORDER BY "id"`,
    ) as {
      id: number;
      previousVirtualIbanId: number | null;
      nextVirtualIbanId: number | null;
    }[];

    expect(rows).toEqual([
      { id: 1, previousVirtualIbanId: 42, nextVirtualIbanId: 42 },
      { id: 2, previousVirtualIbanId: null, nextVirtualIbanId: null },
    ]);

    expect(hasColumn('previousVirtualIbanId')).toBe(true);
    expect(hasColumn('nextVirtualIbanId')).toBe(true);
    expect(hasColumn('previousExternalIban')).toBe(false);
    expect(hasColumn('nextExternalIban')).toBe(false);
  });

  it('aborts before dropping cleartext columns when orphan external IBANs cannot be resolved', async () => {
    db.public.none(`INSERT INTO "virtual_iban" ("id", "iban") VALUES (42, '${matchedIban}')`);

    insertEvent(1, matchedIban, matchedIban);
    insertEvent(2, orphanIban, orphanIban);
    insertEvent(3, null, null);

    await expect(migration.up({ query })).rejects.toThrow(
      /RemovePersonalIbanFromIssuanceEvent: 1 issuance-event row\(s\) still have unresolved external IBAN/,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
    // Column DROP must not have run — abort happens between backfill and drop.
    expect(sql).not.toMatch(/DROP COLUMN/i);

    // Old cleartext columns and orphan values must still be present (no data loss).
    expect(hasColumn('previousExternalIban')).toBe(true);
    expect(hasColumn('nextExternalIban')).toBe(true);

    const rows = db.public.many(
      `SELECT "id", "previousExternalIban", "nextExternalIban"
       FROM "virtual_iban_issuance_event"
       ORDER BY "id"`,
    ) as {
      id: number;
      previousExternalIban: string | null;
      nextExternalIban: string | null;
    }[];

    expect(rows).toEqual([
      { id: 1, previousExternalIban: matchedIban, nextExternalIban: matchedIban },
      { id: 2, previousExternalIban: orphanIban, nextExternalIban: orphanIban },
      { id: 3, previousExternalIban: null, nextExternalIban: null },
    ]);
  });

  it('down() reconstructs original IBAN values via the id join and drops the new columns', async () => {
    db.public.none(`INSERT INTO "virtual_iban" ("id", "iban") VALUES (42, '${matchedIban}')`);
    insertEvent(1, matchedIban, matchedIban);
    insertEvent(2, null, null);

    await migration.up({ query });
    query.mockClear();

    await migration.down({ query });

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);

    const rows = db.public.many(
      `SELECT "id", "previousExternalIban", "nextExternalIban"
       FROM "virtual_iban_issuance_event"
       ORDER BY "id"`,
    ) as {
      id: number;
      previousExternalIban: string | null;
      nextExternalIban: string | null;
    }[];

    expect(rows).toEqual([
      { id: 1, previousExternalIban: matchedIban, nextExternalIban: matchedIban },
      { id: 2, previousExternalIban: null, nextExternalIban: null },
    ]);

    expect(hasColumn('previousExternalIban')).toBe(true);
    expect(hasColumn('nextExternalIban')).toBe(true);
    expect(hasColumn('previousVirtualIbanId')).toBe(false);
    expect(hasColumn('nextVirtualIbanId')).toBe(false);
  });

  it('down() aborts before dropping id columns when reverse backfill cannot resolve virtual_iban rows', async () => {
    db.public.none(`INSERT INTO "virtual_iban" ("id", "iban") VALUES (42, '${matchedIban}')`);
    insertEvent(1, matchedIban, matchedIban);
    insertEvent(2, null, null);

    await migration.up({ query });
    query.mockClear();

    // Simulate a virtual_iban row deleted after up() — reverse join finds no IBAN for id 42.
    db.public.none(`DELETE FROM "virtual_iban" WHERE "id" = 42`);

    await expect(migration.down({ query })).rejects.toThrow(
      /RemovePersonalIbanFromIssuanceEvent down\(\): 1 issuance-event row\(s\) still have unresolved VirtualIban id/,
    );

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
    // id-column DROP must not have run — abort happens between reverse backfill and drop.
    expect(sql).not.toMatch(/DROP COLUMN/i);

    // Post-up shape must still be intact (no silent data loss of the id references).
    expect(hasColumn('previousVirtualIbanId')).toBe(true);
    expect(hasColumn('nextVirtualIbanId')).toBe(true);
    expect(hasColumn('previousExternalIban')).toBe(true);
    expect(hasColumn('nextExternalIban')).toBe(true);

    const rows = db.public.many(
      `SELECT "id", "previousVirtualIbanId", "nextVirtualIbanId", "previousExternalIban", "nextExternalIban"
       FROM "virtual_iban_issuance_event"
       ORDER BY "id"`,
    ) as {
      id: number;
      previousVirtualIbanId: number | null;
      nextVirtualIbanId: number | null;
      previousExternalIban: string | null;
      nextExternalIban: string | null;
    }[];

    expect(rows).toEqual([
      {
        id: 1,
        previousVirtualIbanId: 42,
        nextVirtualIbanId: 42,
        previousExternalIban: null,
        nextExternalIban: null,
      },
      {
        id: 2,
        previousVirtualIbanId: null,
        nextVirtualIbanId: null,
        previousExternalIban: null,
        nextExternalIban: null,
      },
    ]);
  });
});
