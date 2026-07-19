import { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import { DfxLogger } from '../dfx-logger';
import { TypeOrmLogger } from '../typeorm-logger';

// This suite wires a real Postgres exactly like production boot (logNotifications + TypeOrmLogger with
// SQL_LOGGING unset) and proves a boot-blocking migration's RAISE NOTICE reaches the DfxLogger
// (stdout/Loki). It is skipped unless a connection string is provided (so CI, which has no DB, stays
// green); the disposable-DB dry-run on m5me sets it.
const PG_URL = process.env.MIGRATION_TEST_PG;
const describeDb = PG_URL ? describe : describe.skip;

const SCHEMA = 'notice_logging_spec';

// Inline probe migration: the only thing under test is that its RAISE NOTICE (reconciliation counters,
// no PII) surfaces through the boot logger wiring. The class name MUST end with a 13-digit JavaScript
// timestamp — TypeORM's MigrationExecutor parses the timestamp from the last 13 chars of the class name.
class NoticeLoggerProbe1783900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // RAISE NOTICE must live in a PL/pgSQL block; counters only, mirroring the real migrations' output.
    await queryRunner.query(`DO $$ BEGIN RAISE NOTICE 'notice-logger spec: deleted=%, kept=%', 7, 2; END $$;`);
  }

  async down(): Promise<void> {
    // irreversible-by-design: the probe only emits a NOTICE, nothing to revert.
  }
}

describeDb('TypeOrmLogger boot-path (real Postgres RAISE NOTICE -> DfxLogger)', () => {
  let schemaSetup: DataSource;
  let dataSource: DataSource;
  let infoSpy: jest.SpyInstance;

  beforeAll(async () => {
    // WHY schema isolation: (a) rerun idempotency — migrationsRun records the probe in the `migrations`
    // metadata table, so a persistent public.migrations would mark it as executed and the NOTICE would
    // never re-fire on a second run against the same MIGRATION_TEST_PG; dropping and recreating the schema
    // resets that record every run. (b) The catalog assertion below needs a clean scope this suite owns.
    // The postgres driver's `schema` option only qualifies table names (it never runs CREATE SCHEMA and
    // never sets search_path), so a throwaway default-schema connection creates the isolated schema first;
    // the boot-shaped DataSource then sets `schema` so its migrations table lands inside it.
    schemaSetup = new DataSource({ type: 'postgres', url: PG_URL });
    await schemaSetup.initialize();
    await schemaSetup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await schemaSetup.query(`CREATE SCHEMA ${SCHEMA}`);

    // Spy before initialize(): TypeOrmLogger builds its DfxLogger in its constructor and info() resolves
    // off the prototype, so a prototype spy captures the forwarded NOTICE regardless of construction order.
    infoSpy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();

    // Boot-shaped DataSource: logNotifications + our TypeOrmLogger built with `undefined` (SQL_LOGGING
    // unset, i.e. prod). poolSize 1 pins the single pg client that carries the notice listener (the driver
    // attaches it in the one-time pool.connect callback), so the probe deterministically runs on that
    // client. migrationsRun executes the probe during initialize().
    dataSource = new DataSource({
      type: 'postgres',
      url: PG_URL,
      schema: SCHEMA,
      poolSize: 1,
      logNotifications: true,
      logger: new TypeOrmLogger(undefined),
      migrations: [NoticeLoggerProbe1783900000000],
      migrationsRun: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (schemaSetup?.isInitialized) {
      await schemaSetup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await schemaSetup.destroy();
    }
  });

  it('forwards the migration RAISE NOTICE counters to the DfxLogger during boot', () => {
    const notice = infoSpy.mock.calls.find(
      ([message]) => typeof message === 'string' && message.includes('notice-logger spec:'),
    );

    expect(notice).toBeDefined();
    expect(notice?.[0]).toContain('deleted=7, kept=2');
  });

  it('runs the probe inside the isolated schema (migrations metadata table is schema-scoped)', async () => {
    // schema-scoped catalog assertion: a parallel worker's identically-named table must not be counted
    const migrations = await schemaSetup.query(
      `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'migrations'`,
      [SCHEMA],
    );

    expect(migrations[0].count).toBe(1);
  });
});
