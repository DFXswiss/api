import { DataSource } from 'typeorm';

/**
 * Test support for the migration specs that run against a real Postgres.
 *
 * Isolation is per database here, where the projection specs isolate per schema
 * (`projection-test.util.ts`). A schema does not work for a migration: TypeORM generates asymmetric
 * DDL, creating an index unqualified in `up()` and dropping it as `"public"."IDX_..."` in `down()`
 * — 31 of the 116 migrations in this repository do — so a spec running under a `search_path` would
 * create the index in its own schema and then fail to drop it from `public`. Its own database gives
 * the spec a `public` schema of its own, and the migration runs exactly as it does in production.
 */

const MIGRATION_TEST_PG = process.env.MIGRATION_TEST_PG;

/** The configured connection URL, pointed at another database on the same server. */
function urlFor(database: string): string {
  const url = new URL(MIGRATION_TEST_PG);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * A data source over its own empty Postgres database.
 *
 * Every spec file passes its own database name — Jest distributes spec files across workers, and two
 * of them building the same tables would make the result depend on the scheduling rather than on the
 * migration under test.
 */
export async function createMigrationDataSource(database: string): Promise<DataSource> {
  const bootstrap = new DataSource({ type: 'postgres', url: MIGRATION_TEST_PG, logging: false });
  await bootstrap.initialize();
  try {
    // Recreated rather than reused: a database left behind by an interrupted run still holds its
    // tables, and the spec would then assert against rows it did not seed. FORCE because such a run
    // can also leave a session attached, which would otherwise block the drop.
    await bootstrap.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await bootstrap.query(`CREATE DATABASE "${database}"`);
  } finally {
    // Closed even when the database could not be prepared: the caller never receives this instance,
    // so `afterAll` has nothing to close and the connection would outlive the run.
    await bootstrap.destroy();
  }

  const dataSource = new DataSource({ type: 'postgres', url: urlFor(database), logging: false });
  await dataSource.initialize();

  return dataSource;
}

/** Closes the connection and drops the database. Safe to call with `undefined`. */
export async function destroyMigrationDataSource(dataSource: DataSource | undefined, database: string): Promise<void> {
  // Closed first, and dropped from a connection to a different database: Postgres refuses to drop a
  // database that still has a session on it, and this one's own connection is such a session.
  //
  // The drop runs even when closing fails, or a connection this helper could not close would leave
  // the database behind for good — nothing later in the run would revisit it. FORCE is what makes
  // that branch work: it terminates the session that `destroy()` did not.
  try {
    if (dataSource?.isInitialized) await dataSource.destroy();
  } finally {
    const bootstrap = new DataSource({ type: 'postgres', url: MIGRATION_TEST_PG, logging: false });
    await bootstrap.initialize();
    try {
      await bootstrap.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    } finally {
      await bootstrap.destroy();
    }
  }
}
