import { DataSource, QueryRunner } from 'typeorm';

// Runs the real completion migration against a throwaway Postgres. Skipped unless a connection string is
// provided (so CI, which has no DB, stays green); the disposable-DB dry-run on the build host sets it.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

// This suite runs entirely inside its OWN schema (search_path). The sibling real-PG migration spec works in
// `public` and drops/recreates `aktionariat_registration` in its beforeEach; isolating here prevents a
// catalog race when Jest runs the two files concurrently against the same database.
const SCHEMA = 'mig_confirm_flow';

// The migration is plain CommonJS (module.exports = class ...); required lazily inside beforeAll so a
// skipped run (CI, no DB) never pulls the .js through the TS transform.
let CompleteRealUnitConfirmFlow: new () => { up(qr: QueryRunner): Promise<void>; down(qr: QueryRunner): Promise<void> };

// The original (non-unique) index name the base table-creation migration used; down() recreates it.
const INDEX = 'IDX_cafb2b15fa9268c44081bba054';

// Mixed-case EIP-55 addresses as they are stored in the confirmation table; the registration column is
// canonically lowercased, so the migration must bridge the confirmed state via LOWER() on both sides.
const ADDR_A_CHECKSUM = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAA01';
const ADDR_A_LOWER = ADDR_A_CHECKSUM.toLowerCase();
const ADDR_B_LOWER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02';
const ADDR_C_CHECKSUM = '0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCC03';

const CONFIRMED_DATE = '2026-02-01T10:00:00Z';

type NoticeListener = (msg: { message?: string }) => void;
interface NoticeEmitter {
  on(event: 'notice', listener: NoticeListener): void;
  removeListener(event: 'notice', listener: NoticeListener): void;
}

describeDb('CompleteRealUnitConfirmFlow migration (real Postgres)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    CompleteRealUnitConfirmFlow = require('../../../../../migration/1783808567932-CompleteRealUnitConfirmFlow');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      const cleanup = dataSource.createQueryRunner();
      await cleanup.connect();
      await cleanup.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await cleanup.release();
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    qr = dataSource.createQueryRunner();
    await qr.connect();

    // Isolate every statement (prereq schema, the migration's unqualified DDL, and the assertions) in a
    // dedicated schema so a concurrent public-schema spec cannot clobber these tables.
    await qr.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
    await qr.query(`SET search_path TO "${SCHEMA}"`);

    await qr.query(`DROP TABLE IF EXISTS "aktionariat_registration" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "real_unit_address_confirmation" CASCADE`);
    await qr.query(`DROP TABLE IF EXISTS "log" CASCADE`);

    // Minimal prerequisite registration table (only the columns the migration touches). confirmedDate and
    // requiresEmailConfirmation are deliberately absent — the migration adds them. The registration column is
    // canonically lowercased.
    await qr.query(
      `CREATE TABLE "aktionariat_registration" ("id" SERIAL PRIMARY KEY, "walletAddress" character varying(256) NOT NULL, "email" character varying(256) NOT NULL, "active" boolean NOT NULL DEFAULT true)`,
    );
    const insertRegistration = (walletAddress: string, email: string, active: boolean) =>
      qr.query(`INSERT INTO "aktionariat_registration" ("walletAddress", "email", "active") VALUES ($1,$2,$3)`, [
        walletAddress,
        email,
        active,
      ]);
    // R1: active, wallet A — the confirmed one, must receive the bridged confirmedDate.
    await insertRegistration(ADDR_A_LOWER, 'user@example.com', true);
    // R2: active, wallet B — never confirmed, must stay null.
    await insertRegistration(ADDR_B_LOWER, 'user@example.com', true);
    // R3: INACTIVE, wallet A (historical/superseded) — must NOT receive the bridged date (active=true only).
    await insertRegistration(ADDR_A_LOWER, 'user@example.com', false);

    // Minimal prerequisite confirmation table (mixed-case wallets, as in prod) — the migration bridges then
    // drops it.
    await qr.query(
      `CREATE TABLE "real_unit_address_confirmation" ("id" SERIAL PRIMARY KEY, "walletAddress" character varying(256) NOT NULL, "email" character varying(256) NOT NULL, "aktionariatUser" character varying(256) NOT NULL, "aktionariatCode" character varying(256) NOT NULL, "confirmedDate" TIMESTAMP, "responseStatus" integer, "response" text, "created" TIMESTAMP NOT NULL DEFAULT now())`,
    );
    await qr.query(`CREATE INDEX "${INDEX}" ON "real_unit_address_confirmation" ("walletAddress")`);
    const insertConfirmation = (
      walletAddress: string,
      confirmedDate: string | null,
      responseStatus: number,
      response: string,
    ) =>
      qr.query(
        `INSERT INTO "real_unit_address_confirmation" ("walletAddress", "email", "aktionariatUser", "aktionariatCode", "confirmedDate", "responseStatus", "response") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          walletAddress,
          'user@example.com',
          'aktionariat-user-1',
          'CONFIRM-CODE',
          confirmedDate,
          responseStatus,
          response,
        ],
      );
    // C1: confirmed (2xx), mixed-case wallet A — bridges onto R1 and is preserved to the DB log as Info.
    await insertConfirmation(ADDR_A_CHECKSUM, CONFIRMED_DATE, 200, '{"status":200,"message":"ok"}');
    // C2: unconfirmed invalid (4xx), mixed-case wallet C with NO matching registration — not bridged, but
    // still preserved to the DB log (as Warning).
    await insertConfirmation(ADDR_C_CHECKSUM, null, 403, '{"status":403,"message":"Code not found"}');

    // Minimal prerequisite DB `log` table (the columns the preservation INSERT targets; id/created/updated
    // default). Mirrors the Log entity so the runtime shape is exercised.
    await qr.query(
      `CREATE TABLE "log" ("id" SERIAL PRIMARY KEY, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "system" character varying(256) NOT NULL, "subsystem" character varying(256) NOT NULL, "severity" character varying(256) NOT NULL, "message" text NOT NULL, "category" character varying(256), "valid" boolean)`,
    );
  });

  afterEach(async () => {
    await qr.release();
  });

  const runUp = () => new CompleteRealUnitConfirmFlow().up(qr);
  const runDown = () => new CompleteRealUnitConfirmFlow().down(qr);
  const rows = (sql: string, params: any[] = []): Promise<any[]> => qr.query(sql, params);
  const count = async (sql: string, params: any[] = []): Promise<number> => Number((await rows(sql, params))[0].count);

  it('adds confirmedDate + requiresEmailConfirmation (default true) and grandfathers every existing registration to false', async () => {
    await runUp();

    const def = (
      await rows(
        `SELECT column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'aktionariat_registration' AND column_name = 'requiresEmailConfirmation'`,
        [SCHEMA],
      )
    )[0];
    expect(def.column_default).toBe('true');

    const confirmedDateCol = await count(
      `SELECT count(*) FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'aktionariat_registration' AND column_name = 'confirmedDate'`,
      [SCHEMA],
    );
    expect(confirmedDateCol).toBe(1);

    // all three pre-existing rows grandfathered
    expect(
      await count(`SELECT count(*) FROM "aktionariat_registration" WHERE "requiresEmailConfirmation" = false`),
    ).toBe(3);
    expect(
      await count(`SELECT count(*) FROM "aktionariat_registration" WHERE "requiresEmailConfirmation" = true`),
    ).toBe(0);

    // a NEW row still defaults to true (only pre-existing rows were grandfathered)
    await qr.query(
      `INSERT INTO "aktionariat_registration" ("walletAddress", "email", "active") VALUES ('0xnew', 'new@example.com', true)`,
    );
    expect(
      await count(`SELECT count(*) FROM "aktionariat_registration" WHERE "requiresEmailConfirmation" = true`),
    ).toBe(1);
  });

  it('bridges confirmedDate onto the ACTIVE registration via LOWER (mixed-case confirmation → lowercase registration)', async () => {
    await runUp();

    // R1 (active, wallet A) received the confirmed date from the mixed-case confirmation. Compare the exact
    // value IN SQL against the seeded timestamp literal — the column is `timestamp without time zone`, so the
    // node-pg driver would otherwise localise it on read and make an ISO-string compare timezone-fragile.
    const active = await rows(
      `SELECT "confirmedDate" IS NOT NULL AS is_set, "confirmedDate" = TIMESTAMP '2026-02-01 10:00:00' AS matches FROM "aktionariat_registration" WHERE "walletAddress" = $1 AND "active" = true`,
      [ADDR_A_LOWER],
    );
    expect(active).toHaveLength(1);
    expect(active[0].is_set).toBe(true);
    expect(active[0].matches).toBe(true);

    // R3 (INACTIVE, wallet A) was NOT touched — the bridge only latches the active registration
    const inactive = await rows(
      `SELECT "confirmedDate" FROM "aktionariat_registration" WHERE "walletAddress" = $1 AND "active" = false`,
      [ADDR_A_LOWER],
    );
    expect(inactive).toHaveLength(1);
    expect(inactive[0].confirmedDate).toBeNull();

    // R2 (active, wallet B) was never confirmed → stays null
    const unconfirmed = await rows(
      `SELECT "confirmedDate" FROM "aktionariat_registration" WHERE "walletAddress" = $1`,
      [ADDR_B_LOWER],
    );
    expect(unconfirmed).toHaveLength(1);
    expect(unconfirmed[0].confirmedDate).toBeNull();
  });

  it('preserves every confirmation as an Aktionariat/Confirmation DB-log row (severity mapped from responseStatus)', async () => {
    await runUp();

    const logs = await rows(
      `SELECT "system", "subsystem", "category", "severity", "message" FROM "log" WHERE "system" = 'Aktionariat' AND "subsystem" = 'Confirmation' ORDER BY "id"`,
    );
    // one row per existing confirmation (both C1 and C2 preserved, even the unconfirmed one)
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.category).toBe('ServerCall');
      const msg = JSON.parse(log.message);
      expect(msg.action).toBe('confirmConnection');
      expect(msg.migratedFrom).toBe('real_unit_address_confirmation');
    }

    // the confirmed 2xx confirmation is preserved as Info and carries its wallet/response
    const confirmed = logs.find((l) => JSON.parse(l.message).walletAddress === ADDR_A_CHECKSUM);
    expect(confirmed.severity).toBe('Info');
    expect(JSON.parse(confirmed.message).email).toBe('user@example.com');
    expect(JSON.parse(confirmed.message).responseStatus).toBe(200);

    // the invalid 4xx confirmation is preserved as Warning
    const invalid = logs.find((l) => JSON.parse(l.message).walletAddress === ADDR_C_CHECKSUM);
    expect(invalid.severity).toBe('Warning');
  });

  it('drops the real_unit_address_confirmation table', async () => {
    await runUp();

    const table = await count(
      `SELECT count(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'real_unit_address_confirmation'`,
      [SCHEMA],
    );
    expect(table).toBe(0);
  });

  it('logs a reconciliation NOTICE with the grandfather, bridge and preserve counts', async () => {
    const client = (await qr.connect()) as unknown as NoticeEmitter;
    const notices: string[] = [];
    const onNotice: NoticeListener = (msg) => notices.push(msg.message ?? '');
    client.on('notice', onNotice);
    try {
      await runUp();
    } finally {
      client.removeListener('notice', onNotice);
    }

    const reconciliation = notices.find((n) => n.includes('CompleteRealUnitConfirmFlow consolidation'));
    expect(reconciliation).toBeDefined();
    expect(reconciliation).toContain('grandfathered registrations=3,');
    // only C1 matches an active registration with a confirmedDate
    expect(reconciliation).toContain('confirmedDate bridged onto registrations=1,');
    // both confirmations preserved to the DB log
    expect(reconciliation).toContain('confirmations preserved to DB log=2');
  });

  it('down() recreates the confirmation table (non-unique index), reconstructs the confirmed rows, and drops the added columns', async () => {
    await runUp();
    await runDown();

    // the added registration columns are gone
    expect(
      await count(
        `SELECT count(*) FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'aktionariat_registration' AND column_name IN ('confirmedDate', 'requiresEmailConfirmation')`,
        [SCHEMA],
      ),
    ).toBe(0);

    // the table is back with a NON-unique walletAddress index
    const idx = (
      await rows(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [SCHEMA, INDEX])
    )[0];
    expect(idx.indexdef).not.toContain('UNIQUE');

    // exactly the confirmed wallet is reconstructed (from the ACTIVE registration's confirmedDate), lowercased
    const reconstructed = await rows(
      `SELECT "walletAddress", "confirmedDate", "aktionariatUser" FROM "real_unit_address_confirmation"`,
    );
    expect(reconstructed).toHaveLength(1);
    expect(reconstructed[0].walletAddress).toBe(ADDR_A_LOWER);
    expect(reconstructed[0].confirmedDate).toBeInstanceOf(Date);
    // the non-derivable columns get empty-string placeholders
    expect(reconstructed[0].aktionariatUser).toBe('');
  });

  it('leaves the preserved DB-log audit rows in place after a down() rollback (durable audit trail)', async () => {
    await runUp();
    await runDown();

    expect(
      await count(`SELECT count(*) FROM "log" WHERE "system" = 'Aktionariat' AND "subsystem" = 'Confirmation'`),
    ).toBe(2);
  });
});
