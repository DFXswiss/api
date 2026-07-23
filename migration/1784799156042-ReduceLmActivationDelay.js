/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * PROD-ONLY data migration that reduces the global `lmActivationDelay` runtime setting from 15 to 10
 * minutes in production.
 *
 * Guarded to `ENVIRONMENT === 'prd'` for the same reason as the sibling liquidity data migrations
 * (e.g. ReactivateEthZchfLiquidityAndEnableMexcZchfSell): liquidity-management behaviour must not be
 * mutated on dev/loc/CI. Additionally, the `setting` row for `lmActivationDelay` may not exist at
 * all on those environments (fresh/seeded database) - the row-exists precondition would otherwise
 * crash boot there. On prod the row exists. Returning early still records the migration as executed,
 * which is the intended no-op on lower environments.
 *
 * What the setting is:
 *   `lmActivationDelay` is the debounce window (in minutes) a LiquidityManagementRule's
 *   deficit/redundancy condition must persist before a fund-moving pipeline starts. It is read in
 *   `src/subdomains/core/liquidity-management/services/liquidity-management.service.ts` via
 *   `this.settingService.get('lmActivationDelay', '30')`. It is global - it affects ALL liquidity
 *   rules, not a single asset.
 *
 * Prior-value policy:
 *   The exact prior value is deliberately NOT asserted (e.g. no hard requirement that value === '15').
 *   `lmActivationDelay` is a runtime-mutable setting; a strict prior-value assertion would turn a
 *   benign runtime change into a boot-crash on the next deploy. Only the row-exists precondition and
 *   the target post-condition (value === '10') are enforced fail-loud.
 *
 * The lock_timeout is set transaction-scoped via `SET LOCAL lock_timeout` (consistent with the Frick
 * and sibling LM reference migrations); TypeORM runs up()/down() each inside its own transaction.
 *
 * up():
 *   1. prod guard (no-op elsewhere)
 *   2. lock_timeout
 *   3. fail-loud precondition: row key='lmActivationDelay' exists (value not asserted)
 *   4. UPDATE setting value -> '10'
 *   5. fail-loud post-condition: value is exactly '10'
 *
 * down() best-effort restores value='15' (the value at authoring time). This is NOT a guaranteed
 * inverse, because the setting is runtime-mutable and may have been changed after up() ran. No
 * preconditions in down(). Prod-guarded the same way.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ReduceLmActivationDelay1784799156042 {
  name = 'ReduceLmActivationDelay1784799156042';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Liquidity-management settings must NEVER be mutated on dev/loc/CI, and the lmActivationDelay
    // row may not exist there at all (fresh/seeded DB) - the row-exists precondition would crash boot.
    // Returning early still records the migration as executed, which is the intended no-op on lower
    // environments.
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // --- Precondition: row exists (value deliberately not asserted; setting is runtime-mutable) ---
    const before = (
      await queryRunner.query(`
        SELECT "value" FROM "setting" WHERE "key" = 'lmActivationDelay'
      `)
    ).at(0);
    if (!before) {
      throw new Error(
        "Precondition failed: setting row with key='lmActivationDelay' not found",
      );
    }

    await queryRunner.query(`
      UPDATE "setting" SET "value" = '10' WHERE "key" = 'lmActivationDelay'
    `);

    // --- Post-condition: target value must be exactly '10' ---
    const after = (
      await queryRunner.query(`
        SELECT "value" FROM "setting" WHERE "key" = 'lmActivationDelay'
      `)
    ).at(0);
    if (!after || after.value !== '10') {
      throw new Error(
        `Post-condition failed for lmActivationDelay: expected value='10'; got value=${after && after.value}`,
      );
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // Best-effort restore to the value at authoring time ('15'). Not a guaranteed inverse: the
    // setting is runtime-mutable and may have been changed after up() ran. No preconditions.
    await queryRunner.query(`
      UPDATE "setting" SET "value" = '15' WHERE "key" = 'lmActivationDelay'
    `);
  }
};
