import { DataSource, QueryRunner } from 'typeorm';

// This suite runs the real purge against a throwaway Postgres. It is skipped unless a connection string
// is provided (so CI, which has no DB, stays green); the disposable-DB dry-run on m5me sets it. The purge
// is exercised end-to-end: the backfill migration 1783704351182 is run first to produce the very
// aktionariat_registration rows the purge then matches against.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

// Both migrations are plain CommonJS (module.exports = class ...); required lazily inside beforeAll so a
// skipped run (CI, no DB) never pulls the .js through the TS transform.
let AddAktionariatRegistration: new () => { up(qr: QueryRunner): Promise<void>; down(qr: QueryRunner): Promise<void> };
let PurgeRealUnitRegistrationSteps: new () => {
  up(qr: QueryRunner): Promise<void>;
  down(qr: QueryRunner): Promise<void>;
};

// minimal structural view of the underlying pg client — just enough to observe RAISE NOTICE output
// (TypeORM types QueryRunner.connect() as Promise<any>, so the cast pins a safe surface)
type NoticeListener = (msg: { message?: string }) => void;
interface NoticeEmitter {
  on(event: 'notice', listener: NoticeListener): void;
  removeListener(event: 'notice', listener: NoticeListener): void;
}

// deterministic, unique, already-lowercase 20-byte address per account (digits are valid hex)
const addrOf = (n: number): string => `0x${String(n).padStart(40, '0')}`;
const blob = (fields: Record<string, unknown>): string => JSON.stringify(fields);
const personalKyc = { accountType: 'Personal', firstName: 'Erika', lastName: 'Müller' };

describeDb('PurgeRealUnitRegistrationSteps migration (real Postgres purge)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddAktionariatRegistration = require('../../../../../migration/1783704351182-AddAktionariatRegistration');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PurgeRealUnitRegistrationSteps = require('../../../../../migration/1783780521095-PurgeRealUnitRegistrationSteps');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS purge_migration_spec CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    qr = dataSource.createQueryRunner();
    await qr.connect();

    // WHY schema isolation: two real-PG migration specs (this one and the backfill's
    // aktionariat-registration.migration.spec.ts) share the one MIGRATION_TEST_PG database and run in
    // parallel jest workers, so unscoped DROP/CREATE of the identical table names race on the pg catalog
    // (duplicate pg_type entries, "relation does not exist"). Every table name in this spec and in both
    // migrations is unqualified, so the session search_path scopes them all into this spec's own schema.
    // The notice-listener path reuses this same session (qr.connect() returns the existing connection).
    await qr.query(`CREATE SCHEMA IF NOT EXISTS purge_migration_spec`);
    await qr.query(`SET search_path TO purge_migration_spec`);

    // minimal prerequisite schema. "aktionariat_registration" is intentionally NOT created here — the
    // backfill migration creates and populates it, so the purge is tested against real backfill output.
    await qr.query(`DROP TABLE IF EXISTS "kyc_log" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "kyc_file" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "recommendation" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "aktionariat_registration" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "kyc_step" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "log" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "user" CASCADE`);

    await qr.query(
      `CREATE TABLE "user" ("id" SERIAL PRIMARY KEY, "address" character varying(256) NOT NULL, "userDataId" integer)`,
    );
    await qr.query(
      `CREATE TABLE "kyc_step" ("id" SERIAL PRIMARY KEY, "name" character varying NOT NULL, "status" character varying NOT NULL, "result" text, "comment" text, "created" TIMESTAMP NOT NULL DEFAULT now(), "updated" TIMESTAMP NOT NULL DEFAULT now(), "userDataId" integer)`,
    );
    // mirrors the InitialSchema "log" columns the purge writes (created/updated default now())
    await qr.query(
      `CREATE TABLE "log" ("id" SERIAL PRIMARY KEY, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "system" character varying(256) NOT NULL, "subsystem" character varying(256) NOT NULL, "severity" character varying(256) NOT NULL, "message" text NOT NULL, "category" character varying(256), "valid" boolean)`,
    );
    // FK tables mirroring InitialSchema's exact ON DELETE behaviour: kyc_log CASCADE (audit rows would be
    // silently dropped), kyc_file / recommendation NO ACTION (a delete would hard-fail the migration).
    await qr.query(
      `CREATE TABLE "kyc_log" ("id" SERIAL PRIMARY KEY, "kycStepId" integer, CONSTRAINT "FK_test_kyc_log_step" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
    );
    await qr.query(
      `CREATE TABLE "kyc_file" ("id" SERIAL PRIMARY KEY, "kycStepId" integer, CONSTRAINT "FK_test_kyc_file_step" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
    );
    await qr.query(
      `CREATE TABLE "recommendation" ("id" SERIAL PRIMARY KEY, "kycStepId" integer, CONSTRAINT "FK_test_recommendation_step" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
    );
  });

  afterEach(async () => {
    await qr.release();
  });

  const runBackfill = async (): Promise<void> => new AddAktionariatRegistration().up(qr);
  const runPurge = async (): Promise<void> => new PurgeRealUnitRegistrationSteps().up(qr);
  const runPurgeDown = async (): Promise<void> => new PurgeRealUnitRegistrationSteps().down(qr);

  const rows = async (sql: string, params: any[] = []): Promise<any[]> => qr.query(sql, params);
  const count = async (sql: string, params: any[] = []): Promise<number> =>
    Number((await qr.query(sql, params))[0].count);

  const insertUser = (id: number, address: string, userDataId: number): Promise<unknown> =>
    qr.query(`INSERT INTO "user" ("id","address","userDataId") VALUES ($1,$2,$3)`, [id, address, userDataId]);

  const insertStep = (
    name: string,
    status: string,
    result: string | null,
    created: string,
    userDataId: number,
    comment: string | null = null,
  ): Promise<number> =>
    qr
      .query(
        `INSERT INTO "kyc_step" ("name","status","result","created","updated","userDataId","comment") VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id`,
        [name, status, result, created, userDataId, comment],
      )
      .then((r: any[]) => Number(r[0].id));

  // seeds a user (id = userDataId = n, address = addrOf(n)) plus one structurally complete
  // RealUnitRegistration step in that account, so the backfill migrates it and the purge can match it.
  const seedRegistered = async (
    n: number,
    opts: { status?: string; comment?: string | null } = {},
  ): Promise<{ n: number; address: string; stepId: number }> => {
    const address = addrOf(n);
    await insertUser(n, address, n);
    const stepId = await insertStep(
      'RealUnitRegistration',
      opts.status ?? 'Completed',
      blob({
        email: `u${n}@example.com`,
        walletAddress: address,
        signature: `0xsig${n}`,
        registrationDate: '2026-05-01',
        kycData: personalKyc,
      }),
      '2026-05-01T10:00:00Z',
      n,
      opts.comment ?? null,
    );
    return { n, address, stepId };
  };

  // runs fn while listening for RAISE NOTICE on the underlying pg client (same pattern as the backfill spec)
  const captureNotices = async (fn: () => Promise<void>): Promise<string[]> => {
    const client = (await qr.connect()) as NoticeEmitter;
    const notices: string[] = [];
    const onNotice: NoticeListener = (msg) => notices.push(msg.message ?? '');
    client.on('notice', onNotice);
    try {
      await fn();
    } finally {
      client.removeListener('notice', onNotice);
    }
    return notices;
  };

  const purgeNotice = (notices: string[]): string => {
    const notice = notices.find((n) => n.includes('purge reconciliation'));
    expect(notice).toBeDefined();
    return notice as string;
  };

  const parseCounters = (notice: string): Record<string, number> => {
    const counters: Record<string, number> = {};
    for (const [, key, value] of notice.matchAll(/(\w+)=(\d+)/g)) counters[key] = Number(value);
    return counters;
  };

  it('deletes every migrated step end-to-end, leaving aktionariat_registration and foreign steps untouched', async () => {
    await seedRegistered(1);
    await seedRegistered(2);
    await seedRegistered(3, { status: 'Failed' }); // Failed is migrated too -> its data is in the new table
    // foreign steps that must never be touched: a valid non-RealUnit step and an invalid-JSON one
    await insertStep('ContactData', 'Completed', blob({ mail: 'x@example.com' }), '2026-05-02T10:00:00Z', 1);
    await insertStep('NationalityData', 'Completed', 'this-is-not-json', '2026-05-03T10:00:00Z', 1);

    await runBackfill();
    expect(await count(`SELECT count(*) FROM "aktionariat_registration"`)).toBe(3);

    await runPurge();

    // every RealUnitRegistration step whose data is in the new table is gone
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(0);
    // the single source of truth is left exactly as the backfill wrote it
    expect(await count(`SELECT count(*) FROM "aktionariat_registration"`)).toBe(3);
    // foreign steps survive
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" IN ('ContactData','NationalityData')`)).toBe(2);
  });

  it('keeps steps that were never migrated (invalid JSON, missing field, ghost wallet) and counts each bucket', async () => {
    // invalid-JSON blob (has a user, but corrupt result -> never migrated)
    await insertUser(1, addrOf(1), 1);
    await insertStep('RealUnitRegistration', 'Completed', '{"walletAddress": ', '2026-05-01T10:00:00Z', 1);
    // valid JSON but missing the signature field -> never migrated
    await insertUser(2, addrOf(2), 2);
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({ email: 'm@example.com', walletAddress: addrOf(2), registrationDate: '2026-05-01' }),
      '2026-05-01T10:00:00Z',
      2,
    );
    // complete blob but no "user" in the step's account -> unresolvable, never migrated
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({ email: 'g@example.com', walletAddress: addrOf(999), signature: '0xsigG', registrationDate: '2026-05-01' }),
      '2026-05-01T10:00:00Z',
      3,
    );

    await runBackfill();
    expect(await count(`SELECT count(*) FROM "aktionariat_registration"`)).toBe(0); // none migratable

    const notices = await captureNotices(runPurge);
    const notice = purgeNotice(notices);

    // all three survive the purge
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(3);
    expect(notice).toContain('invalid_json=1,');
    expect(notice).toContain('without_wallet_or_fields=1,');
    expect(notice).toContain('unresolved_or_mismatched=1,');
    expect(notice).toContain('deleted=0,');
  });

  it("scopes the match to the step's own account: an identical wallet+signature in another account is kept", async () => {
    // account 1: user with a mixed-case address + complete step (signature S) -> migrated by the backfill
    // (registration row carries the lowercased wallet). InitialSchema's user.address UNIQUE is on the
    // exact string, so a cross-account lower(address) collision is constructible with different casings.
    const mixedAddr = '0xAbCdAbCdAbCdAbCdAbCdAbCdAbCdAbCdAbCdAb01';
    await insertUser(1, mixedAddr, 1);
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'a@example.com',
        walletAddress: mixedAddr,
        signature: '0xsigS',
        registrationDate: '2026-05-01',
        kycData: personalKyc,
      }),
      '2026-05-01T10:00:00Z',
      1,
    );
    // account 2: complete step with the SAME lowercase wallet and SAME signature S, but NO user row in
    // account 2 -> never migrated. An EXISTS without the account scope (u."userDataId" = s."userDataId")
    // would match account 1's registration via wallet+signature and wrongly delete this step too.
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'b@example.com',
        walletAddress: mixedAddr.toLowerCase(),
        signature: '0xsigS',
        registrationDate: '2026-05-01',
        kycData: personalKyc,
      }),
      '2026-05-02T10:00:00Z',
      2,
    );

    await runBackfill();
    expect(await count(`SELECT count(*) FROM "aktionariat_registration"`)).toBe(1); // account 1 only

    const notice = purgeNotice(await captureNotices(runPurge));

    // account 1's migrated step is purged; account 2's un-migrated twin survives in its own account
    const remaining = await rows(`SELECT "userDataId" FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`);
    expect(remaining).toHaveLength(1);
    expect(Number(remaining[0].userDataId)).toBe(2);
    expect(notice).toContain('deleted=1,');
    expect(notice).toContain('unresolved_or_mismatched=1,');
  });

  it('keeps a step whose exact signature is not in the registration table (post-cutover re-registration)', async () => {
    await runBackfill(); // empty source: creates an empty aktionariat_registration

    // The purge ships in a later release than the backfill: by then the wallet may have re-registered
    // through the NEW flow, so the account's registration row carries a DIFFERENT signature (S2). The
    // legacy step's blob (S1) is then NOT verifiably migrated and must be kept; a signature-less EXISTS
    // (wallet + account only) would wrongly delete it.
    const address = addrOf(1);
    await insertUser(1, address, 1);
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'a@example.com',
        walletAddress: address,
        signature: '0xsigS1',
        registrationDate: '2026-05-01',
        kycData: personalKyc,
      }),
      '2026-05-01T10:00:00Z',
      1,
    );
    await qr.query(
      `INSERT INTO "aktionariat_registration" ("walletAddress","email","registrationDate","signature","status","active","userId") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [address, 'a@example.com', '2026-06-01', '0xsigS2', 'Completed', true, 1],
    );

    const notice = purgeNotice(await captureNotices(runPurge));

    // same account + same wallet, but the step's exact signature S1 is nowhere in the new table -> kept
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(1);
    expect(notice).toContain('unresolved_or_mismatched=1,');
    expect(notice).toContain('deleted=0,');
  });

  it('keeps FK-referenced steps and never cascade-deletes their kyc_log audit rows', async () => {
    const s1 = await seedRegistered(1);
    const s2 = await seedRegistered(2);
    const s3 = await seedRegistered(3);

    await runBackfill();
    expect(await count(`SELECT count(*) FROM "aktionariat_registration"`)).toBe(3);

    // reference one migrated step from each FK table (kyc_log cascades, kyc_file/recommendation NO ACTION)
    await qr.query(`INSERT INTO "kyc_log" ("kycStepId") VALUES ($1)`, [s1.stepId]);
    await qr.query(`INSERT INTO "kyc_file" ("kycStepId") VALUES ($1)`, [s2.stepId]);
    await qr.query(`INSERT INTO "recommendation" ("kycStepId") VALUES ($1)`, [s3.stepId]);

    const notices = await captureNotices(runPurge);
    const notice = purgeNotice(notices);

    // all three are kept despite being migrated, because they are still externally referenced
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(3);
    expect(notice).toContain('kept_referenced=3,');
    expect(notice).toContain('deleted=0,');
    // crucially: the kyc_log row was NOT cascade-deleted (its step was never deleted)
    expect(await count(`SELECT count(*) FROM "kyc_log"`)).toBe(1);
    expect(await count(`SELECT count(*) FROM "kyc_file"`)).toBe(1);
    expect(await count(`SELECT count(*) FROM "recommendation"`)).toBe(1);
  });

  it('preserves the manual-review comment of a deletable step into the log table before deleting it', async () => {
    const reason = 'Manual review: name/address mismatch';
    const withComment = await seedRegistered(1, { comment: reason });
    await seedRegistered(2); // deletable, no comment -> no log row

    await runBackfill();

    const notices = await captureNotices(runPurge);
    const notice = purgeNotice(notices);

    // both deletable steps are gone
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(0);

    // exactly one preserved log row (only the commented step produces one)
    const logs = await rows(
      `SELECT "system","subsystem","severity","category","message" FROM "log" WHERE "system" = 'Aktionariat' AND "subsystem" = 'Registration'`,
    );
    expect(logs).toHaveLength(1);
    const log = logs[0];
    expect(log.system).toBe('Aktionariat');
    expect(log.subsystem).toBe('Registration');
    expect(log.severity).toBe('Info');
    expect(log.category).toBe(withComment.address); // lower(walletAddress); addrOf is already lowercase

    const message = JSON.parse(log.message);
    expect(message.action).toBe('purgeLegacyRegistrationStep');
    expect(Number(message.kycStepId)).toBe(withComment.stepId);
    expect(message.status).toBe('Completed');
    expect(message.comment).toBe(reason);

    expect(notice).toContain('comments_preserved=1,');
    expect(notice).toContain('deleted=2,');
  });

  it('completes when a foreign invalid-JSON step and a RealUnitRegistration invalid-JSON step are present (fence pin)', async () => {
    await seedRegistered(1);
    // a foreign non-JSON step (the classification join would otherwise cast every scanned row)
    await insertStep('NationalityData', 'Completed', 'totally-not-json', '2026-06-01T10:00:00Z', 1);
    // an invalid-JSON step on the SAME name the cast targets -> must be filtered by pg_input_is_valid
    await insertUser(2, addrOf(2), 2);
    await insertStep('RealUnitRegistration', 'Completed', '{"walletAddress": ', '2026-06-02T10:00:00Z', 2);

    await runBackfill();

    await expect(runPurge()).resolves.toBeUndefined();

    // the migrated step is purged; the corrupt sibling and the foreign step both survive
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(1);
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'NationalityData'`)).toBe(1);
  });

  it('logs the reconciliation counters via RAISE NOTICE (trailing-delimiter-safe)', async () => {
    for (let n = 1; n <= 5; n++) await seedRegistered(n); // 5 deletable
    await insertUser(10, addrOf(10), 10);
    await insertStep('RealUnitRegistration', 'Completed', 'not-json', '2026-05-01T10:00:00Z', 10); // invalid_json
    await insertUser(11, addrOf(11), 11);
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({ email: 'x@example.com', walletAddress: addrOf(11), registrationDate: '2026-05-01' }), // no signature
      '2026-05-01T10:00:00Z',
      11,
    );
    // complete blob, no user in account 12 -> unresolved
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({ email: 'y@example.com', walletAddress: addrOf(12), signature: '0xsig12', registrationDate: '2026-05-01' }),
      '2026-05-01T10:00:00Z',
      12,
    );

    await runBackfill();

    const notice = purgeNotice(await captureNotices(runPurge));

    // assert including the trailing delimiter, so e.g. 'deleted=50' can never satisfy 'deleted=5'
    expect(notice).toContain('source=8,');
    expect(notice).toContain('invalid_json=1,');
    expect(notice).toContain('without_wallet_or_fields=1,');
    expect(notice).toContain('unresolved_or_mismatched=1,');
    expect(notice).toContain('kept_referenced=0,');
    expect(notice).toContain('deleted=5,');
    expect(notice).toContain('comments_preserved=0,');
    expect(notice).toMatch(/remaining_after=3$/); // 8 source - 5 deleted
  });

  it('keeps the partition identity (source = invalid + missing + unresolved + kept + deleted)', async () => {
    for (let n = 1; n <= 4; n++) await seedRegistered(n); // deletable
    await insertUser(10, addrOf(10), 10);
    await insertStep('RealUnitRegistration', 'Completed', 'broken{', '2026-05-01T10:00:00Z', 10); // invalid_json
    await insertStep('RealUnitRegistration', 'Completed', null, '2026-05-01T10:00:00Z', 10); // null result -> missing
    // FK-referenced deletable step
    const referenced = await seedRegistered(5);

    await runBackfill();
    await qr.query(`INSERT INTO "recommendation" ("kycStepId") VALUES ($1)`, [referenced.stepId]);

    const counters = parseCounters(purgeNotice(await captureNotices(runPurge)));

    // the identity the migration enforces with RAISE EXCEPTION, re-checked from the emitted values
    expect(counters.source).toBe(
      counters.invalid_json +
        counters.without_wallet_or_fields +
        counters.unresolved_or_mismatched +
        counters.kept_referenced +
        counters.deleted,
    );
    expect(counters.kept_referenced).toBe(1);
    expect(counters.deleted).toBe(4);
  });

  it('runs clean on an empty database with all-zero counters', async () => {
    await runBackfill(); // creates an empty aktionariat_registration

    const notice = purgeNotice(await captureNotices(runPurge));

    expect(notice).toContain('source=0,');
    expect(notice).toContain('invalid_json=0,');
    expect(notice).toContain('deleted=0,');
    expect(notice).toContain('kept_referenced=0,');
    expect(notice).toContain('comments_preserved=0,');
    expect(notice).toMatch(/remaining_after=0$/);
  });

  it('down() is an irreversible-by-design no-op (purged rows stay gone, no throw)', async () => {
    await seedRegistered(1);
    await runBackfill();
    await runPurge();
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(0);

    // down does not restore the purged data and does not throw (matches DeactivateCitreaTestnetAssets)
    await expect(runPurgeDown()).resolves.toBeUndefined();
    expect(await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`)).toBe(0);
  });
});
