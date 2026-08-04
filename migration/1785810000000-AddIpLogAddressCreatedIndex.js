/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add a composite index on `ip_log ("address", "created")` so that assigning a freshly signed-up
 * user to their earlier anonymous log rows stops needing a helper lookup over the whole table.
 *
 * What this replaces. `IpLogService.updateUserIpLogs` used to bound its update by id: it first
 * resolved the newest row older than the retention window (`WHERE created <= $1 ORDER BY id DESC
 * LIMIT 1`) and then updated `id > thatId AND address = ...`. Neither `created` nor `address` had
 * a supporting index - `ip_log` carried indexes on `userId` and `userDataId` only, besides the
 * primary key on `id` - so the bounding lookup had to find its row through an unindexed `created`
 * and became the dominant cost of the sign-up path. In production traces that statement
 * was observed at 1.65 s and, on a colder cache, 7.51 s (measured externally against production
 * traces; not reproducible from this repository). The lookup was memoised, but its cache key was
 * derived from the retention date and therefore rotated daily, so the cost recurred.
 *
 * With this index the predicate is expressed directly as `address = ... AND created > ...`, which
 * this index serves, and the helper lookup is deleted rather than accelerated. `address` leads
 * because it is the equality predicate; `created` follows as the range bound.
 *
 * Table size at the time of measurement (measured externally against production; not reproducible
 * from this repository): 5,589,634 rows, of which 266,929 fall inside the 180-day window the
 * update touches, growing by roughly 2,000 rows per day.
 *
 * Honest disclaimer: no production `EXPLAIN` was taken for this change - the access path above is
 * derived from the predicate and the index definition, not from an observed plan change. What is
 * measured is the statement duration quoted above and the row counts; the plan is not.
 *
 * `CREATE INDEX CONCURRENTLY` is deliberately not used: migrations here run inside a single
 * transaction (TypeORM default `migrationsTransactionMode: "all"`, and `src/config/config.ts` sets
 * only `migrationsRun`), and CONCURRENTLY is not permitted inside a transaction.
 *
 * Lock behaviour, stated precisely: a plain `CREATE INDEX` holds a SHARE lock for the whole build.
 * Reads continue, writes to `ip_log` are blocked while it is held, and because locks are released
 * only at COMMIT, that hold extends until every migration in the same batch has committed. This
 * table is written on essentially every request that passes the IP guard, so the block is not
 * hypothetical. `SET LOCAL lock_timeout` bounds only how long we WAIT to acquire the lock, not how
 * long we hold it; it is transaction-scoped, hence set once per direction rather than per
 * statement. Migrations run boot-blockingly, so the starting instance is not itself serving
 * traffic; a conflicting writer would be a predecessor instance during a rolling deploy. On
 * conflict the migration aborts after the timeout and the app start fails with it - fail-closed
 * and intended, but it is a deploy abort and is named as such.
 *
 * `down()` takes an ACCESS EXCLUSIVE lock for `DROP INDEX`, which conflicts with every other lock
 * mode including the one a plain `SELECT` takes, so it blocks reads as well as writes.
 *
 * Index name: `IDX_e5dc02783d6f40cd4bf14cecc9` on `ip_log ("address", "created")`. This is the
 * deterministic name TypeORM's DefaultNamingStrategy generates, since custom index naming is
 * disallowed by CONTRIBUTING.md: `IDX_` followed by the first 26 hex characters of
 * `sha1('ip_log_address_created')` (table name plus the column names sorted alphabetically and
 * joined with `_`). The physical column order stays `("address", "created")`; only the name
 * derivation sorts them.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddIpLogAddressCreatedIndex1785810000000 {
  name = 'AddIpLogAddressCreatedIndex1785810000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // SET LOCAL is transaction-scoped and bounds the WAIT for the lock, not how long it is held.
    // Set once: this migration issues a single CREATE INDEX.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`CREATE INDEX "IDX_e5dc02783d6f40cd4bf14cecc9" ON "ip_log" ("address", "created")`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // SET LOCAL is transaction-scoped and bounds the WAIT for the lock, not how long it is held.
    // Set once: this migration issues a single DROP INDEX.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e5dc02783d6f40cd4bf14cecc9"`);
  }
};
