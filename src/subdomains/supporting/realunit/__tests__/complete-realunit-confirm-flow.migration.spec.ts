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

// The original (non-unique) index name the base table-creation migration used, reused (now UNIQUE) here.
const INDEX = 'IDX_cafb2b15fa9268c44081bba054';

// Mixed-case EIP-55 addresses as they may arrive from the client; the migration lowercases the queryable
// column. ADDR_B is seeded twice, differing only in case, to exercise the case-collision merge.
const ADDR_A = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAA01';
const ADDR_B_UPPER = '0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBB02';
const ADDR_B_LOWER = ADDR_B_UPPER.toLowerCase();
const ADDR_C_LOWER = '0xcccccccccccccccccccccccccccccccccccccc03'; // already lowercase, no collision

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

    // Minimal prerequisite tables (only the columns the migration touches). requiresEmailConfirmation is
    // deliberately absent — the migration adds it.
    await qr.query(`CREATE TABLE "aktionariat_registration" ("id" SERIAL PRIMARY KEY)`);
    await qr.query(`INSERT INTO "aktionariat_registration" DEFAULT VALUES`);
    await qr.query(`INSERT INTO "aktionariat_registration" DEFAULT VALUES`);
    await qr.query(`INSERT INTO "aktionariat_registration" DEFAULT VALUES`);

    await qr.query(
      `CREATE TABLE "real_unit_address_confirmation" ("id" SERIAL PRIMARY KEY, "walletAddress" character varying(256) NOT NULL, "confirmedDate" TIMESTAMP, "created" TIMESTAMP NOT NULL DEFAULT now())`,
    );
    // the original non-unique index the migration converts to UNIQUE
    await qr.query(`CREATE INDEX "${INDEX}" ON "real_unit_address_confirmation" ("walletAddress")`);

    const insertConfirmation = (walletAddress: string, confirmedDate: string | null, created: string) =>
      qr.query(
        `INSERT INTO "real_unit_address_confirmation" ("walletAddress", "confirmedDate", "created") VALUES ($1,$2,$3)`,
        [walletAddress, confirmedDate, created],
      );

    // 1) plain mixed-case row, confirmed
    await insertConfirmation(ADDR_A, '2026-02-01T10:00:00Z', '2026-02-01T10:00:00Z');
    // 2) case-collision pair on ADDR_B: the confirmed (latch) row is older, the unconfirmed variant newer.
    //    The merge must keep the confirmed row and delete the case-variant.
    await insertConfirmation(ADDR_B_UPPER, '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z'); // latch, kept
    await insertConfirmation(ADDR_B_LOWER, null, '2026-03-01T10:00:00Z'); // newer, deleted
    // 3) already-lowercase row, unconfirmed
    await insertConfirmation(ADDR_C_LOWER, null, '2026-02-05T10:00:00Z');
  });

  afterEach(async () => {
    await qr.release();
  });

  const runUp = () => new CompleteRealUnitConfirmFlow().up(qr);
  const runDown = () => new CompleteRealUnitConfirmFlow().down(qr);
  const rows = (sql: string, params: any[] = []): Promise<any[]> => qr.query(sql, params);
  const count = async (sql: string, params: any[] = []): Promise<number> => Number((await rows(sql, params))[0].count);

  it('adds requiresEmailConfirmation (default true) and grandfathers every existing registration to false', async () => {
    await runUp();

    const def = (
      await rows(
        `SELECT column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'aktionariat_registration' AND column_name = 'requiresEmailConfirmation'`,
        [SCHEMA],
      )
    )[0];
    expect(def.column_default).toBe('true');

    expect(
      await count(`SELECT count(*) FROM "aktionariat_registration" WHERE "requiresEmailConfirmation" = false`),
    ).toBe(3);
    expect(
      await count(`SELECT count(*) FROM "aktionariat_registration" WHERE "requiresEmailConfirmation" = true`),
    ).toBe(0);

    // a NEW row still defaults to true (only pre-existing rows were grandfathered)
    await qr.query(`INSERT INTO "aktionariat_registration" DEFAULT VALUES`);
    expect(
      await count(`SELECT count(*) FROM "aktionariat_registration" WHERE "requiresEmailConfirmation" = true`),
    ).toBe(1);
  });

  it('merges the case-collision keeping the confirmedDate latch, then lowercases every walletAddress', async () => {
    await runUp();

    // total drops from 4 to 3 (the case-variant duplicate is deleted)
    expect(await count(`SELECT count(*) FROM "real_unit_address_confirmation"`)).toBe(3);

    // every walletAddress is lowercase
    expect(
      await count(
        `SELECT count(*) FROM "real_unit_address_confirmation" WHERE "walletAddress" <> lower("walletAddress")`,
      ),
    ).toBe(0);

    // Only one ADDR_B row survives, and it is the confirmed (latch-bearing) variant — the unconfirmed
    // case-variant (confirmedDate IS NULL) was the one deleted. (IS NOT NULL keeps this timezone-agnostic;
    // the column is `timestamp without time zone`.)
    const bRows = await rows(
      `SELECT ("confirmedDate" IS NOT NULL) AS confirmed FROM "real_unit_address_confirmation" WHERE "walletAddress" = $1`,
      [ADDR_B_LOWER],
    );
    expect(bRows).toHaveLength(1);
    expect(bRows[0].confirmed).toBe(true);
  });

  it('replaces the non-unique walletAddress index with a UNIQUE one under the same name', async () => {
    await runUp();

    const idx = (
      await rows(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [SCHEMA, INDEX])
    )[0];
    expect(idx.indexdef).toContain('UNIQUE');

    // the UNIQUE index is enforced: a second row with the same lowercased wallet is rejected
    await expect(
      qr.query(`INSERT INTO "real_unit_address_confirmation" ("walletAddress", "created") VALUES ($1, now())`, [
        ADDR_A.toLowerCase(),
      ]),
    ).rejects.toThrow();
  });

  it('logs a reconciliation NOTICE with the grandfather, collision, delete and lowercase counts', async () => {
    const client = (await qr.connect()) as unknown as NoticeEmitter;
    const notices: string[] = [];
    const onNotice: NoticeListener = (msg) => notices.push(msg.message ?? '');
    client.on('notice', onNotice);
    try {
      await runUp();
    } finally {
      client.removeListener('notice', onNotice);
    }

    const reconciliation = notices.find((n) => n.includes('CompleteRealUnitConfirmFlow reconciliation'));
    expect(reconciliation).toBeDefined();
    expect(reconciliation).toContain('grandfathered registrations=3,');
    expect(reconciliation).toContain('confirmation case-collision groups=1,');
    expect(reconciliation).toContain('duplicate confirmation rows deleted=1,');
    // ADDR_A and the kept ADDR_B latch row were mixed-case; ADDR_C was already lowercase
    expect(reconciliation).toContain('confirmation rows lowercased=2');
  });

  it('down() drops the column and restores a non-unique walletAddress index', async () => {
    await runUp();
    await runDown();

    const col = await count(
      `SELECT count(*) FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'aktionariat_registration' AND column_name = 'requiresEmailConfirmation'`,
      [SCHEMA],
    );
    expect(col).toBe(0);

    const idx = (
      await rows(`SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`, [SCHEMA, INDEX])
    )[0];
    expect(idx.indexdef).not.toContain('UNIQUE');
  });
});
