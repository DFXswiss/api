import { DataSource, QueryRunner } from 'typeorm';

// This suite runs the real backfill against a throwaway Postgres. It is skipped unless a connection
// string is provided (so CI, which has no DB, stays green); the disposable-DB dry-run on m5me sets it.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

// The migration is plain CommonJS (module.exports = class ...); required lazily inside beforeAll so a
// skipped run (CI, no DB) never pulls the .js through the TS transform.
let AddAktionariatRegistration: new () => { up(qr: QueryRunner): Promise<void>; down(qr: QueryRunner): Promise<void> };

// Mixed-case EIP-55 addresses as they arrive from the client; the backfill lowercases the queryable
// column but must keep the exact casing inside signedPayload.
const ADDR = {
  a: '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAA01',
  b: '0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBB02',
  c: '0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCC03',
  d: '0xDDddDDddDDddDDddDDddDDddDDddDDddDDddDD04',
  e: '0xEEeeEEeeEEeeEEeeEEeeEEeeEEeeEEeeEEeeEE05',
  f: '0xFFffFFffFFffFFffFFffFFffFFffFFffFFffFF06',
  g: '0x7777777777777777777777777777777777777707', // older Completed + newer Failed
  h: '0x8888888888888888888888888888888888888808', // InternalReview -> ManualReview
  i: '0x1010101010101010101010101010101010101009', // Canceled only -> terminal, never active
  j: '0x2020202020202020202020202020202020202010', // older InternalReview + newer Canceled
  ghost: '0x9999999999999999999999999999999999999999', // no matching "user" row
};

const blob = (fields: Record<string, unknown>): string => JSON.stringify(fields);

const personalKyc = { accountType: 'Personal', firstName: 'Erika', lastName: 'Müller' };
const orgKyc = { accountType: 'Organization', organizationName: 'RealUnit AG' };

// minimal structural view of the underlying pg client — just enough to observe RAISE NOTICE output
// (TypeORM types QueryRunner.connect() as Promise<any>, so the cast pins a safe surface)
type NoticeListener = (msg: { message?: string }) => void;
interface NoticeEmitter {
  on(event: 'notice', listener: NoticeListener): void;
  removeListener(event: 'notice', listener: NoticeListener): void;
}

describeDb('AddAktionariatRegistration migration (real Postgres backfill)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddAktionariatRegistration = require('../../../../../migration/1783704351182-AddAktionariatRegistration');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  // inserts a kyc_step; userDataId is the owning account and must match the resolved user's
  const insertStep = (name: string, status: string, result: string | null, created: string, userDataId: number) =>
    qr.query(
      `INSERT INTO "kyc_step" ("name","status","result","created","updated","userDataId") VALUES ($1,$2,$3,$4,$4,$5)`,
      [name, status, result, created, userDataId],
    );

  beforeEach(async () => {
    qr = dataSource.createQueryRunner();
    await qr.connect();

    // minimal prerequisite schema (only the columns the backfill reads)
    await qr.query(`DROP TABLE IF EXISTS "aktionariat_registration" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "kyc_step" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "user" CASCADE`);
    await qr.query(
      `CREATE TABLE "user" ("id" SERIAL PRIMARY KEY, "address" character varying(256) NOT NULL, "userDataId" integer)`,
    );
    await qr.query(
      `CREATE TABLE "kyc_step" ("id" SERIAL PRIMARY KEY, "name" character varying NOT NULL, "status" character varying NOT NULL, "result" text, "created" TIMESTAMP NOT NULL DEFAULT now(), "updated" TIMESTAMP NOT NULL DEFAULT now(), "userDataId" integer)`,
    );

    // users (one wallet-User per registered address; note: no user for ADDR.ghost). Each user carries its
    // own account id ("userDataId"), 1:1 with the wallet-user here, so the account-scoped resolution join
    // matches every seeded step.
    await qr.query(
      `INSERT INTO "user" ("id", "address", "userDataId") VALUES (1,$1,1),(2,$2,2),(3,$3,3),(4,$4,4),(5,$5,5),(6,$6,6),(7,$7,7),(8,$8,8),(9,$9,9),(10,$10,10)`,
      [ADDR.a, ADDR.b, ADDR.c, ADDR.d, ADDR.e, ADDR.f, ADDR.g, ADDR.h, ADDR.i, ADDR.j],
    );

    // kyc_steps — the seed scenarios
    // 1) Normal completed registration (Personal), mixed-case wallet
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'a@example.com',
        walletAddress: ADDR.a,
        signature: '0xsigA',
        registrationDate: '2026-05-01',
        kycData: personalKyc,
      }),
      '2026-05-01T10:00:00Z',
      1,
    );
    // 2) Re-registration for the same wallet -> supersede: older + newer completed step
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'b@example.com',
        walletAddress: ADDR.b,
        signature: '0xsigB_old',
        registrationDate: '2026-04-01',
        kycData: personalKyc,
      }),
      '2026-04-01T10:00:00Z',
      2,
    );
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'b@example.com',
        walletAddress: ADDR.b,
        signature: '0xsigB_new',
        registrationDate: '2026-06-01',
        kycData: personalKyc,
      }),
      '2026-06-01T10:00:00Z',
      2,
    );
    // 3) Failed step -> migrated but never active
    await insertStep(
      'RealUnitRegistration',
      'Failed',
      blob({
        email: 'c@example.com',
        walletAddress: ADDR.c,
        signature: '0xsigC',
        registrationDate: '2026-05-02',
        kycData: personalKyc,
      }),
      '2026-05-02T10:00:00Z',
      3,
    );
    // 4+5) Two different wallets registered under the SAME email (multi-wallet confirm resolution)
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'shared@example.com',
        walletAddress: ADDR.d,
        signature: '0xsigD',
        registrationDate: '2026-05-03',
        kycData: personalKyc,
      }),
      '2026-05-03T10:00:00Z',
      4,
    );
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'shared@example.com',
        walletAddress: ADDR.e,
        signature: '0xsigE',
        registrationDate: '2026-05-04',
        kycData: personalKyc,
      }),
      '2026-05-04T10:00:00Z',
      5,
    );
    // 6) CORPORATION registration -> kycData preserved with organization fields
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'f@example.com',
        walletAddress: ADDR.f,
        signature: '0xsigF',
        registrationDate: '2026-05-05',
        kycData: orgKyc,
      }),
      '2026-05-05T10:00:00Z',
      6,
    );
    // 7) Blob without a walletAddress -> not resolvable, counted, never inserted
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({ email: 'g@example.com', signature: '0xsigG', registrationDate: '2026-05-06', kycData: personalKyc }),
      '2026-05-06T10:00:00Z',
      7,
    );
    // 8) Wallet with no matching "user" row -> not resolvable, counted, never inserted
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'h@example.com',
        walletAddress: ADDR.ghost,
        signature: '0xsigH',
        registrationDate: '2026-05-07',
        kycData: personalKyc,
      }),
      '2026-05-07T10:00:00Z',
      8,
    );
    // 9) Unrelated step -> must be ignored by the name filter
    await insertStep('ContactData', 'Completed', blob({ mail: 'noise@example.com' }), '2026-05-08T10:00:00Z', 1);
    // 10a) Older COMPLETED + newer FAILED on the SAME wallet-user -> the COMPLETED must stay active
    // (terminal steps are ranked last), never leaving the user with no active row.
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'g@example.com',
        walletAddress: ADDR.g,
        signature: '0xsigG_ok',
        registrationDate: '2026-03-01',
        kycData: personalKyc,
      }),
      '2026-03-01T10:00:00Z',
      7,
    );
    await insertStep(
      'RealUnitRegistration',
      'Failed',
      blob({
        email: 'g@example.com',
        walletAddress: ADDR.g,
        signature: '0xsigG_fail',
        registrationDate: '2026-07-01',
        kycData: personalKyc,
      }),
      '2026-07-01T10:00:00Z',
      7,
    );
    // 10b) Non-terminal, non-completed step (InternalReview) -> status maps to ManualReview, active
    await insertStep(
      'RealUnitRegistration',
      'InternalReview',
      blob({
        email: 'h@example.com',
        walletAddress: ADDR.h,
        signature: '0xsigH_ir',
        registrationDate: '2026-05-09',
        kycData: personalKyc,
      }),
      '2026-05-09T10:00:00Z',
      8,
    );
    // 11) Canceled step on its own wallet-user -> migrated, status kept 'Canceled', never active
    await insertStep(
      'RealUnitRegistration',
      'Canceled',
      blob({
        email: 'i@example.com',
        walletAddress: ADDR.i,
        signature: '0xsigI',
        registrationDate: '2026-05-10',
        kycData: personalKyc,
      }),
      '2026-05-10T10:00:00Z',
      9,
    );
    // 12) Older InternalReview (non-terminal) + newer Canceled on the SAME wallet-user -> the InternalReview
    // (mapped to ManualReview) stays active; the terminal Canceled is ranked last and never active.
    await insertStep(
      'RealUnitRegistration',
      'InternalReview',
      blob({
        email: 'j@example.com',
        walletAddress: ADDR.j,
        signature: '0xsigJ_ir',
        registrationDate: '2026-03-10',
        kycData: personalKyc,
      }),
      '2026-03-10T10:00:00Z',
      10,
    );
    await insertStep(
      'RealUnitRegistration',
      'Canceled',
      blob({
        email: 'j@example.com',
        walletAddress: ADDR.j,
        signature: '0xsigJ_cancel',
        registrationDate: '2026-07-10',
        kycData: personalKyc,
      }),
      '2026-07-10T10:00:00Z',
      10,
    );
  });

  afterEach(async () => {
    await qr.release();
  });

  const runUp = async () => new AddAktionariatRegistration().up(qr);
  const runDown = async () => new AddAktionariatRegistration().down(qr);

  const rows = async (sql: string, params: any[] = []): Promise<any[]> => qr.query(sql, params);
  const count = async (sql: string, params: any[] = []): Promise<number> =>
    Number((await qr.query(sql, params))[0].count);

  it('inserts exactly one row per resolvable step and skips the unresolvable ones', async () => {
    await runUp();

    const total = await count(`SELECT count(*) FROM "aktionariat_registration"`);
    // resolvable: S1, S2a, S2b, S3, S4, S5, S6, G_ok, G_fail, H_ir, I, J_ir, J_cancel (13);
    // skipped: S7 (no wallet), S8 (no user).
    expect(total).toBe(13);
  });

  it('reconciles source, inserted and every non-resolvable remainder (nothing silently dropped)', async () => {
    await runUp();

    const sourceTotal = await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`);
    const sourceWithWallet = await count(
      `SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration' AND result IS NOT NULL AND (result::jsonb ->> 'walletAddress') IS NOT NULL`,
    );
    const sourceWithRequired = await count(
      `SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration' AND result IS NOT NULL AND (result::jsonb ->> 'walletAddress') IS NOT NULL AND (result::jsonb ->> 'email') IS NOT NULL AND (result::jsonb ->> 'registrationDate') IS NOT NULL AND (result::jsonb ->> 'signature') IS NOT NULL`,
    );
    const inserted = await count(`SELECT count(*) FROM "aktionariat_registration"`);

    expect(sourceTotal).toBe(15); // 14 with-wallet (incl. ghost) + 1 no-wallet
    expect(sourceWithWallet).toBe(14);
    expect(sourceWithRequired).toBe(14); // every with-wallet blob also carries the required fields
    expect(inserted).toBe(13);
    expect(sourceWithWallet - sourceWithRequired).toBe(0); // field missing
    expect(sourceWithRequired - inserted).toBe(1); // ADDR.ghost: complete blob but no user
    expect(sourceTotal - sourceWithWallet).toBe(1); // blob without a walletAddress
  });

  it('keeps a single active row per wallet-user and supersedes the older re-registration', async () => {
    await runUp();

    // active: A, B(new), D, E, F, G(older Completed), H(InternalReview->ManualReview); inactive: B(old), C, G(Failed); user 9 (Canceled) has none; user 10 (InternalReview->ManualReview) active
    const active = await count(`SELECT count(*) FROM "aktionariat_registration" WHERE "active" = true`);
    expect(active).toBe(8);

    // user 2 (wallet B) has exactly one active row, and it is the newer signature
    const bRows = await rows(
      `SELECT "signature", "active" FROM "aktionariat_registration" WHERE "userId" = 2 ORDER BY "active" DESC`,
    );
    expect(bRows).toHaveLength(2);
    const bActive = bRows.filter((r) => r.active);
    expect(bActive).toHaveLength(1);
    expect(bActive[0].signature).toBe('0xsigB_new');

    // the failed step is migrated but never active, with its status copied verbatim
    const cRow = (await rows(`SELECT "status", "active" FROM "aktionariat_registration" WHERE "userId" = 3`))[0];
    expect(cRow.status).toBe('Failed');
    expect(cRow.active).toBe(false);
  });

  it('keeps the older COMPLETED active when a newer step is terminal (no fail-closed lockout)', async () => {
    await runUp();

    // user 7: older Completed + newer Failed. The Failed must NOT win the ranking, or the user would
    // end up with no active row (locked out of buy/sell). The Completed stays active.
    const gRows = await rows(
      `SELECT "signature", "status", "active" FROM "aktionariat_registration" WHERE "userId" = 7`,
    );
    expect(gRows).toHaveLength(2);
    const gActive = gRows.filter((r) => r.active);
    expect(gActive).toHaveLength(1);
    expect(gActive[0].signature).toBe('0xsigG_ok');
    expect(gActive[0].status).toBe('Completed');
    const gFailed = gRows.find((r) => r.status === 'Failed');
    expect(gFailed.active).toBe(false);
  });

  it('maps a non-terminal non-completed step (InternalReview) to an active ManualReview row', async () => {
    await runUp();

    // user 8: InternalReview -> mapped to ManualReview so it is admin-re-forwardable and active
    const hRow = (await rows(`SELECT "status", "active" FROM "aktionariat_registration" WHERE "userId" = 8`))[0];
    expect(hRow.status).toBe('ManualReview');
    expect(hRow.active).toBe(true);
  });

  it('keeps a Canceled step terminal (migrated, never active) and never lets it win the ranking', async () => {
    await runUp();

    // user 9: a lone Canceled step is migrated with its status kept, but is never active
    const iRow = (await rows(`SELECT "status", "active" FROM "aktionariat_registration" WHERE "userId" = 9`))[0];
    expect(iRow.status).toBe('Canceled');
    expect(iRow.active).toBe(false);

    // user 10: older InternalReview + newer Canceled -> the non-terminal InternalReview (->ManualReview)
    // stays active, the terminal Canceled is ranked last and inactive (mirrors the Failed scenario)
    const jRows = await rows(`SELECT "status", "active" FROM "aktionariat_registration" WHERE "userId" = 10`);
    expect(jRows).toHaveLength(2);
    const jActive = jRows.filter((r) => r.active);
    expect(jActive).toHaveLength(1);
    expect(jActive[0].status).toBe('ManualReview');
    const jCanceled = jRows.find((r) => r.status === 'Canceled');
    expect(jCanceled.active).toBe(false);
  });

  it('lowercases the queryable walletAddress but keeps the exact signed casing in signedPayload', async () => {
    await runUp();

    const row = (
      await rows(
        `SELECT "walletAddress", "signedPayload", "kycData", "status", "forwardedToAktionariatDate" FROM "aktionariat_registration" WHERE "userId" = 1`,
      )
    )[0];

    expect(row.walletAddress).toBe(ADDR.a.toLowerCase());
    const signed = JSON.parse(row.signedPayload);
    expect(signed.walletAddress).toBe(ADDR.a); // mixed case preserved for EIP-712 re-verification
    expect(signed.kycData).toBeUndefined(); // kycData split out of signedPayload
    expect(row.status).toBe('Completed');
    expect(row.forwardedToAktionariatDate).not.toBeNull(); // COMPLETED -> forwarded date set
  });

  it('preserves kycData (Personal and Organization) split out into its own column', async () => {
    await runUp();

    const aKyc = JSON.parse(
      (await rows(`SELECT "kycData" FROM "aktionariat_registration" WHERE "userId" = 1`))[0].kycData,
    );
    expect(aKyc).toEqual(personalKyc);

    const fKyc = JSON.parse(
      (await rows(`SELECT "kycData" FROM "aktionariat_registration" WHERE "userId" = 6`))[0].kycData,
    );
    expect(fKyc).toEqual(orgKyc);
    expect(fKyc.accountType).toBe('Organization');
  });

  it('resolves every wallet registered under a shared email (multi-wallet confirm)', async () => {
    await runUp();

    const shared = await rows(
      `SELECT "walletAddress" FROM "aktionariat_registration" WHERE LOWER("email") = 'shared@example.com' ORDER BY "walletAddress"`,
    );
    expect(shared.map((r) => r.walletAddress)).toEqual([ADDR.d.toLowerCase(), ADDR.e.toLowerCase()]);
  });

  it('completes when a foreign invalid-JSON step and a NULL-result registration are present (crash-vector guard)', async () => {
    // A foreign step whose result is not valid JSON must never reach the jsonb cast (the resolution join
    // would otherwise cast every scanned row), and a NULL-result RealUnitRegistration step must be filtered
    // out too. Neither may crash the boot-blocking migration.
    await insertStep('NationalityData', 'Completed', 'this-is-not-json', '2026-08-02T10:00:00Z', 1);
    await insertStep('RealUnitRegistration', 'Completed', null, '2026-08-03T10:00:00Z', 2);

    await expect(runUp()).resolves.toBeUndefined();

    // baseline stays intact; neither the foreign nor the NULL-result row produces a registration
    const total = await count(`SELECT count(*) FROM "aktionariat_registration"`);
    expect(total).toBe(13);
  });

  it('skips a RealUnitRegistration step with an invalid-JSON result and still migrates its valid siblings', async () => {
    // a corrupt (unparseable) blob on a RealUnitRegistration step: filtered by pg_input_is_valid, never cast
    await insertStep('RealUnitRegistration', 'Completed', '{"walletAddress": ', '2026-08-04T10:00:00Z', 3);

    await expect(runUp()).resolves.toBeUndefined();

    // the corrupt blob is steered out; every valid sibling still migrates
    const total = await count(`SELECT count(*) FROM "aktionariat_registration"`);
    expect(total).toBe(13);
  });

  it('attributes a shared address to the account that owns the step, not the lowest user id', async () => {
    // The same lowercased address exists under two accounts; the LOWER user id (11) belongs to the WRONG
    // account, the step belongs to the higher-id user's account (200 -> user 12). The registration must
    // land on user 12, proving the join is constrained by "userDataId", not just lower(address).
    const sharedAddr = '0xABCabcABCabcABCabcABCabcABCabcABCabcAB11';
    await qr.query(`INSERT INTO "user" ("id","address","userDataId") VALUES (11,$1,100),(12,$1,200)`, [sharedAddr]);
    await insertStep(
      'RealUnitRegistration',
      'Completed',
      blob({
        email: 'shared-account@example.com',
        walletAddress: sharedAddr,
        signature: '0xsigShared',
        registrationDate: '2026-08-05',
        kycData: personalKyc,
      }),
      '2026-08-05T10:00:00Z',
      200,
    );

    await runUp();

    const resolved = await rows(`SELECT "userId" FROM "aktionariat_registration" WHERE "walletAddress" = $1`, [
      sharedAddr.toLowerCase(),
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].userId).toBe(12); // step's account (200 -> user 12), never the lowest id (11)
  });

  it('counts an invalid-JSON blob as its own rejection class and keeps the reconciliation identity', async () => {
    // one corrupt RealUnitRegistration blob -> counted as invalid json, excluded from the backfill
    await insertStep('RealUnitRegistration', 'Completed', 'not-json-at-all', '2026-08-06T10:00:00Z', 4);

    // observe the DO block's RAISE NOTICE on the underlying pg client, so the test fails if the
    // reconciliation counter is wrong or removed (not just the re-implemented counting below)
    const client = (await qr.connect()) as NoticeEmitter;
    const notices: string[] = [];
    const onNotice: NoticeListener = (msg) => notices.push(msg.message ?? '');
    client.on('notice', onNotice);
    try {
      await runUp();
    } finally {
      client.removeListener('notice', onNotice);
    }

    const reconciliation = notices.find((n) => n.includes('backfill reconciliation'));
    expect(reconciliation).toBeDefined();
    expect(reconciliation).toContain('invalid json blob=1'); // the corrupt blob added above
    expect(reconciliation).toContain('inserted=13'); // baseline unchanged; the corrupt blob never inserts

    const sourceTotal = await count(`SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration'`);
    const invalidJson = await count(
      `SELECT count(*) FROM "kyc_step" WHERE "name" = 'RealUnitRegistration' AND result IS NOT NULL AND NOT pg_input_is_valid(result, 'jsonb')`,
    );
    // cast-safe wallet/required counts behind the same MATERIALIZED fence the migration uses
    const withWallet = await count(
      `WITH steps AS MATERIALIZED (SELECT result::jsonb AS blob FROM "kyc_step" WHERE "name" = 'RealUnitRegistration' AND result IS NOT NULL AND pg_input_is_valid(result, 'jsonb')) SELECT count(*) FROM steps WHERE blob ->> 'walletAddress' IS NOT NULL`,
    );
    const withRequired = await count(
      `WITH steps AS MATERIALIZED (SELECT result::jsonb AS blob FROM "kyc_step" WHERE "name" = 'RealUnitRegistration' AND result IS NOT NULL AND pg_input_is_valid(result, 'jsonb')) SELECT count(*) FROM steps WHERE blob ->> 'walletAddress' IS NOT NULL AND blob ->> 'email' IS NOT NULL AND blob ->> 'registrationDate' IS NOT NULL AND blob ->> 'signature' IS NOT NULL`,
    );
    const inserted = await count(`SELECT count(*) FROM "aktionariat_registration"`);

    // the re-implemented counts must agree with the logged reconciliation values
    expect(invalidJson).toBe(1);
    expect(inserted).toBe(13);

    const fieldMissing = withWallet - withRequired;
    const unresolvedUser = withRequired - inserted;
    const blobWithoutWallet = sourceTotal - invalidJson - withWallet;
    // full partition: every source step falls into exactly one bucket
    expect(invalidJson + blobWithoutWallet + fieldMissing + unresolvedUser + inserted).toBe(sourceTotal);
  });

  it('down() drops the table cleanly', async () => {
    await runUp();
    await runDown();

    const exists = await count(
      `SELECT count(*) FROM information_schema.tables WHERE table_name = 'aktionariat_registration'`,
    );
    expect(exists).toBe(0);
  });
});
