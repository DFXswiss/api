import { newDb } from 'pg-mem';

type Migration = {
  up(queryRunner: { query(sql: string): Promise<unknown> }): Promise<void>;
  down(queryRunner: { query(sql: string): Promise<unknown> }): Promise<void>;
};

let AddPersonalIbanProviderFrick: new () => Migration;
let AddVirtualIbanLifecycleEvent: new () => Migration;

describe('Bank Frick personal-IBAN migrations against a real schema', () => {
  let db: ReturnType<typeof newDb>;
  let query: jest.Mock<Promise<unknown>, [string]>;

  beforeAll(() => {
    // The migrations are plain CommonJS modules, matching TypeORM's runtime loader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddPersonalIbanProviderFrick = require('../../../../../../migration/1784878282365-AddPersonalIbanProviderFrick');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddVirtualIbanLifecycleEvent = require('../../../../../../migration/1785100000000-AddVirtualIbanLifecycleEvent');
  });

  beforeEach(() => {
    db = newDb();
    // Deliberately no primary key: production tables are not guaranteed to have one.
    db.public.none(`CREATE TABLE "transaction_request" ("id" integer, "label" text)`);
    query = jest.fn(async (sql: string) => {
      // pg-mem has no session/transaction LOCAL settings; this is a PostgreSQL session no-op here.
      if (/^\s*SET\s+LOCAL\b/i.test(sql)) return;
      if (/^\s*SELECT\b/i.test(sql)) return db.public.many(sql);
      db.public.none(sql);
    });
  });

  const runInitialUp = async (): Promise<void> => {
    await new AddPersonalIbanProviderFrick().up({ query });
  };

  const insertIntent = (values: {
    requestReference: string;
    userDataId: number;
    currencyId: number;
    bankId: number;
    buyId?: number | null;
    provider?: string | null;
    status?: string | null;
  }): void => {
    const provider =
      values.provider === undefined ? `'Bank Frick'` : values.provider === null ? 'NULL' : `'${values.provider}'`;
    const status = values.status === undefined ? `'Pending'` : values.status === null ? 'NULL' : `'${values.status}'`;
    db.public.none(
      `INSERT INTO "virtual_iban_issuance_intent"
        ("requestReference", "userDataId", "currencyId", "bankId", "provider", "buyId", "status")
       VALUES (
         '${values.requestReference}', ${values.userDataId}, ${values.currencyId}, ${values.bankId},
         ${provider}, ${values.buyId ?? 'NULL'}, ${status}
       )`,
    );
  };

  it('enforces the real required columns and separate user/buy ownership claims without foreign keys', async () => {
    await runInitialUp();

    insertIntent({
      requestReference: 'user-claim-1',
      userDataId: 999001,
      currencyId: 999002,
      bankId: 999003,
    });
    expect(() =>
      insertIntent({
        requestReference: 'user-claim-duplicate',
        userDataId: 999001,
        currencyId: 999002,
        bankId: 999003,
      }),
    ).toThrow(/unique/i);

    // A buy-scoped claim does not collide with the user's personal claim.
    insertIntent({
      requestReference: 'buy-claim-1',
      userDataId: 999001,
      currencyId: 999002,
      bankId: 999003,
      buyId: 7001,
      provider: 'Yapeal',
    });
    expect(() =>
      insertIntent({
        requestReference: 'buy-claim-duplicate',
        userDataId: 123456,
        currencyId: 999002,
        bankId: 999003,
        buyId: 7001,
        provider: 'Yapeal',
      }),
    ).toThrow(/unique/i);

    expect(() =>
      insertIntent({
        requestReference: 'null-provider',
        userDataId: 1,
        currencyId: 2,
        bankId: 3,
        provider: null,
      }),
    ).toThrow(/null/i);
    expect(() =>
      insertIntent({
        requestReference: 'null-status',
        userDataId: 4,
        currencyId: 5,
        bankId: 6,
        status: null,
      }),
    ).toThrow(/null/i);

    expect(db.public.many(`SELECT "provider", "buyId" FROM "virtual_iban_issuance_intent" ORDER BY "id"`)).toEqual([
      { provider: 'Bank Frick', buyId: null },
      { provider: 'Yapeal', buyId: 7001 },
    ]);
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
  });

  it('uses persisted rows to refuse a destructive initial-migration rollback, then rolls back an empty schema', async () => {
    await runInitialUp();
    db.public.none(`INSERT INTO "transaction_request" ("id", "bankId") VALUES (1, 42)`);
    insertIntent({
      requestReference: 'persisted-claim',
      userDataId: 1,
      currencyId: 2,
      bankId: 3,
    });

    await expect(new AddPersonalIbanProviderFrick().down({ query })).rejects.toThrow(
      'refusing to destroy 2 persisted issuance/history/routing value',
    );

    db.public.none(`DELETE FROM "virtual_iban_issuance_intent"`);
    db.public.none(`UPDATE "transaction_request" SET "bankId" = NULL, "virtualIbanId" = NULL`);
    await expect(new AddPersonalIbanProviderFrick().down({ query })).resolves.toBeUndefined();
    expect(() => db.public.none(`SELECT "bankId" FROM "transaction_request"`)).toThrow();
    expect(() => db.public.none(`SELECT * FROM "virtual_iban_issuance_intent"`)).toThrow();
  });

  it('backfills and enforces lifecycle ownership/reason columns on the real preceding schema', async () => {
    await runInitialUp();
    db.public.none(
      `INSERT INTO "virtual_iban_issuance_event"
        ("intentId", "userDataId", "currencyId", "bankId", "previousStatus", "nextStatus")
       VALUES (991, 992, 993, 994, 'Pending', 'InFlight')`,
    );

    await new AddVirtualIbanLifecycleEvent().up({ query });

    expect(
      db.public.one(
        `SELECT "previousUserDataId", "nextUserDataId"
           FROM "virtual_iban_issuance_event"
          WHERE "intentId" = 991`,
      ),
    ).toEqual({ previousUserDataId: 992, nextUserDataId: 992 });

    db.public.none(
      `INSERT INTO "virtual_iban_lifecycle_event"
        ("virtualIbanId", "previousUserDataId", "nextUserDataId", "previousActive", "nextActive",
         "transitionedAt", "reason")
       VALUES (9001, 9002, 9003, true, false, now(), 'schema-backed ownership transition')`,
    );
    expect(() =>
      db.public.none(
        `INSERT INTO "virtual_iban_lifecycle_event"
          ("virtualIbanId", "previousUserDataId", "nextUserDataId", "previousActive", "nextActive",
           "transitionedAt", "reason")
         VALUES (1, 2, 3, true, false, now(), NULL)`,
      ),
    ).toThrow(/null/i);
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/REFERENCES|FOREIGN KEY/i);
  });

  it('uses real audit rows to refuse lifecycle rollback, then removes the empty lifecycle schema', async () => {
    await runInitialUp();
    await new AddVirtualIbanLifecycleEvent().up({ query });
    db.public.none(
      `INSERT INTO "virtual_iban_lifecycle_event"
        ("virtualIbanId", "previousUserDataId", "nextUserDataId", "previousActive", "nextActive",
         "transitionedAt", "reason")
       VALUES (1, 2, 3, true, false, now(), 'persisted audit')`,
    );

    await expect(new AddVirtualIbanLifecycleEvent().down({ query })).rejects.toThrow(
      'refusing to destroy 1 append-only audit row',
    );

    db.public.none(`DELETE FROM "virtual_iban_lifecycle_event"`);
    await expect(new AddVirtualIbanLifecycleEvent().down({ query })).resolves.toBeUndefined();
    expect(() => db.public.none(`SELECT * FROM "virtual_iban_lifecycle_event"`)).toThrow();
    expect(() => db.public.none(`SELECT "previousUserDataId" FROM "virtual_iban_issuance_event"`)).toThrow();
  });
});
