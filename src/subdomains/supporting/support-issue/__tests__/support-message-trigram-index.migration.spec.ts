import { DataSource, QueryRunner } from 'typeorm';

// Runs the real trigram-index migration against a throwaway Postgres. Skipped unless a connection
// string is provided, same contract as the other *.migration.spec.ts suites here.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

// Two of the cases below can only be built by manipulating database-GLOBAL state: dropping the
// pg_trgm extension and creating a login role. The MIGRATION_TEST_PG database is shared by ~10
// real-Postgres suites running in parallel jest workers, and that global DDL perturbs their catalog
// access enough to make their own unqualified-table races fire (verified: with these two cases
// enabled, five unrelated migration specs failed with `relation "user" already exists`; without
// them, all 57 passed). They are therefore opt-in and point at a database nobody else is using:
//   MIGRATION_TEST_PG_EXCLUSIVE=1 MIGRATION_TEST_PG=postgres://... npx jest support-message-trigram
const itExclusive = process.env.MIGRATION_TEST_PG_EXCLUSIVE ? it : it.skip;

const INDEX = 'IDX_support_message_message_trgm';

// Deliberately NOT schema-isolated, unlike the sibling suites: the migration's down() drops
// "public"."IDX_..." by the repo's convention, so a spec running in its own schema would create the
// index somewhere down() never looks and the removal assertions would pass for the wrong reason.
// The catalog assertions are scoped to public instead, so a parallel worker cannot be counted.
let AddSupportMessageTrigramIndex: new () => {
  up(qr: QueryRunner): Promise<void>;
  down(qr: QueryRunner): Promise<void>;
};

describeDb('AddSupportMessageTrigramIndex migration (real Postgres)', () => {
  let dataSource: DataSource;
  let qr: QueryRunner;

  const indexCount = async (runner: QueryRunner = qr): Promise<number> =>
    +(
      await runner.query(`SELECT count(*)::int AS c FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, [
        INDEX,
      ])
    )[0].c;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    AddSupportMessageTrigramIndex = require('../../../../../migration/1784900000000-AddSupportMessageTrigramIndex');
    dataSource = new DataSource({ type: 'postgres', url: PG_URL });
    await dataSource.initialize();
  });

  afterAll(async () => {
    const cleanup = dataSource.createQueryRunner();
    await cleanup.connect();
    await cleanup.query(`DROP TABLE IF EXISTS "public"."support_message" CASCADE`);
    await cleanup.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    qr = dataSource.createQueryRunner();
    await qr.connect();
    // minimal shape: the migration only needs the table and its message column to exist
    await qr.query(`CREATE TABLE IF NOT EXISTS "public"."support_message" ("id" serial PRIMARY KEY, "message" text)`);
    await qr.query(`DROP INDEX IF EXISTS "public"."${INDEX}"`);
  });

  afterEach(async () => {
    await qr.query(`DROP INDEX IF EXISTS "public"."${INDEX}"`);
    await qr.release();
  });

  it('creates the trigram index when pg_trgm can be used', async () => {
    await new AddSupportMessageTrigramIndex().up(qr);

    expect(await indexCount()).toBe(1);
    const [{ indexdef }] = await qr.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      [INDEX],
    );
    expect(indexdef).toContain('gin');
    expect(indexdef).toContain('gin_trgm_ops');
  });

  it('removes it again on down, and down survives a skipped up', async () => {
    const migration = new AddSupportMessageTrigramIndex();
    await migration.up(qr);
    await migration.down(qr);
    expect(await indexCount()).toBe(0);

    // up() legitimately skips when the extension cannot be used, so down() must not throw on a
    // database where the index was never created
    await expect(migration.down(qr)).resolves.not.toThrow();
  });

  it('is idempotent - a second up leaves exactly one index and does not throw', async () => {
    const migration = new AddSupportMessageTrigramIndex();
    await migration.up(qr);
    await expect(migration.up(qr)).resolves.not.toThrow();
    expect(await indexCount()).toBe(1);
  });

  // Runs in CI, unlike the two opt-in cases below: it needs no global DDL and no extra role, but it
  // still exercises the one property the whole DO/EXCEPTION construction exists for - a failing
  // CREATE INDEX must not abort the surrounding batch. Without the handler this test goes red.
  it('contains a failing CREATE INDEX so the migration batch stays usable', async () => {
    await qr.startTransaction();
    try {
      // make the index impossible to build inside this transaction
      await qr.query(`DROP TABLE "public"."support_message" CASCADE`);

      await expect(new AddSupportMessageTrigramIndex().up(qr)).resolves.not.toThrow();
      // the batch must survive, otherwise every remaining migration rolls back and the API cannot boot
      await expect(qr.query(`SELECT 1 AS ok`)).resolves.toEqual([{ ok: 1 }]);
    } finally {
      await qr.rollbackTransaction();
    }
  });

  // The failure mode a privilege check alone does NOT cover: pg_extension reports pg_trgm as present
  // (it is database-wide) while the operator class is not resolvable, because the extension lives in a
  // schema outside the search_path - a normal managed-database layout. Without the EXCEPTION handler
  // around CREATE INDEX this aborts the migration transaction and the API does not boot.
  itExclusive('skips without throwing when pg_trgm exists but its opclass is not resolvable', async () => {
    const isSuper =
      +(await qr.query(`SELECT count(*)::int AS c FROM pg_roles WHERE rolname = current_user AND rolsuper`))[0].c > 0;
    if (!isSuper) return;

    const hadExtension = +(await qr.query(`SELECT count(*)::int AS c FROM pg_extension WHERE extname = 'pg_trgm'`))[0]
      .c;
    await qr.query(`DROP EXTENSION IF EXISTS pg_trgm CASCADE`);
    await qr.query(`CREATE SCHEMA IF NOT EXISTS trgm_spec_ext`);
    await qr.query(`CREATE EXTENSION pg_trgm SCHEMA trgm_spec_ext`);
    await qr.query(`SET LOCAL search_path TO public`);

    try {
      await qr.startTransaction();
      await expect(new AddSupportMessageTrigramIndex().up(qr)).resolves.not.toThrow();
      // the batch must survive so the remaining migrations can still run
      await expect(qr.query(`SELECT 1 AS ok`)).resolves.toEqual([{ ok: 1 }]);
      await qr.rollbackTransaction();
    } finally {
      await qr.query(`DROP EXTENSION IF EXISTS pg_trgm CASCADE`);
      await qr.query(`DROP SCHEMA IF EXISTS trgm_spec_ext CASCADE`);
      if (hadExtension) await qr.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    }
  });

  // The reason the DO block wraps its DDL in EXCEPTION handlers at all: migrations run at boot inside
  // ONE transaction, so a failure here would roll the whole batch back and the API would not start.
  // This exercises the skip path with a role that genuinely cannot create the extension, instead of
  // asserting it on the superuser CI connection where the branch is never taken.
  itExclusive(
    'skips without throwing, and leaves the batch usable, for a role that may not install pg_trgm',
    async () => {
      const role = `trgm_spec_lowpriv`;
      const canManageRoles =
        +(await qr.query(`SELECT count(*)::int AS c FROM pg_roles WHERE rolname = current_user AND rolsuper`))[0].c > 0;
      if (!canManageRoles) return; // not a superuser connection: nothing to prove here

      const hadExtension = +(await qr.query(`SELECT count(*)::int AS c FROM pg_extension WHERE extname = 'pg_trgm'`))[0]
        .c;
      await qr.query(`DROP EXTENSION IF EXISTS pg_trgm CASCADE`);
      await qr.query(`DROP ROLE IF EXISTS ${role}`);
      await qr.query(`CREATE ROLE ${role} LOGIN PASSWORD 'x'`);
      await qr.query(`GRANT ALL ON SCHEMA public TO ${role}`);
      await qr.query(`GRANT ALL ON TABLE "public"."support_message" TO ${role}`);

      const url = new URL(PG_URL as string);
      const restricted = new DataSource({
        type: 'postgres',
        host: url.hostname,
        port: +(url.port || 5432),
        username: role,
        password: 'x',
        database: url.pathname.replace(/^\//, ''),
      });

      try {
        await restricted.initialize();
        const lowQr = restricted.createQueryRunner();
        await lowQr.connect();
        await lowQr.startTransaction();

        await expect(new AddSupportMessageTrigramIndex().up(lowQr)).resolves.not.toThrow();
        expect(await indexCount(lowQr)).toBe(0);

        // the whole point: the surrounding transaction must still be usable afterwards
        await expect(lowQr.query(`SELECT 1 AS ok`)).resolves.toEqual([{ ok: 1 }]);
        await lowQr.rollbackTransaction();
        await lowQr.release();
      } finally {
        if (restricted.isInitialized) await restricted.destroy();
        await qr.query(`REVOKE ALL ON TABLE "public"."support_message" FROM ${role}`);
        await qr.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
        await qr.query(`DROP ROLE IF EXISTS ${role}`);
        if (hadExtension) await qr.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      }
    },
  );
});
