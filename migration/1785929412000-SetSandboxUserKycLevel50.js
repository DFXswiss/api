/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * DEV-ONLY data migration that raises one sandbox test user to kycLevel 50 (LEVEL_50 / DFX Approval).
 *
 * An external tester needs the full post-approval flow in the sandbox. The target is the single
 * user_data row with kycHash 628CDA30-9E81-4294-997A-DB79E3B4DB36. Trading and AML gates require
 * kycLevel >= 50, so setting that one field is enough for the test goal. No other fields and no
 * kyc_step rows are touched.
 *
 * Guarded to ENVIRONMENT === 'dev' (sandbox). On loc, CI and prd this is a guaranteed no-op.
 * The guard is positive (=== 'dev'), not a negation of prd: a synthetic KYC level without a real
 * process on production would be a compliance incident, so the migration must never run there.
 *
 * Current kycLevel of the target row in the sandbox DB is unknown (and the row may be absent).
 * Both unknowns are handled without error: the UPDATE only raises (AND "kycLevel" < 50), and a
 * missing row yields zero matches. Zero matches is not a failure — it signals the hash is not
 * present in that environment.
 *
 * up():
 *   1. dev guard (no-op elsewhere)
 *   2. lock_timeout
 *   3. backup current kycLevel into setting under
 *      sandboxKycLevelBackup:1785929412000:628CDA30-9E81-4294-997A-DB79E3B4DB36
 *      Value format: '<kycLevel>|1785929412000' — the trailing timestamp is an origin marker so
 *      down() only restores/deletes rows this migration wrote. A foreign row with the same key
 *      but without (or with a different) marker is left untouched.
 *      (ON CONFLICT DO NOTHING so a re-run keeps the first real prior value)
 *   4. set kycLevel = 50 where still below 50
 *
 * down() restores from the backup setting only when the origin marker matches this migration's
 * timestamp, then deletes that setting. Without a matching marked backup row it changes nothing
 * — it never invents a default prior level and never removes a foreign same-key row.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SetSandboxUserKycLevel501785929412000 {
  name = 'SetSandboxUserKycLevel501785929412000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Sandbox-only: a synthetic KYC level must never land on loc/prd/CI. Returning early still
    // records the migration as executed, which is the intended no-op on all other environments.
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // Persist the pre-migration kycLevel so down() can restore it. Value carries an origin marker
    // ('<level>|1785929412000') so down() only rolls back what this migration produced. ON CONFLICT
    // DO NOTHING is decisive: a re-run must not overwrite the first (real) prior value with the 50
    // already written by a previous successful up(). If the user_data row is missing, the SELECT
    // yields no row and nothing is inserted — that is correct, not an error.
    await queryRunner.query(`
      INSERT INTO "setting" ("key", "value", "updated", "created")
      SELECT
        'sandboxKycLevelBackup:1785929412000:628CDA30-9E81-4294-997A-DB79E3B4DB36',
        "kycLevel"::text || '|1785929412000',
        NOW(),
        NOW()
      FROM "user_data"
      WHERE "kycHash" = '628CDA30-9E81-4294-997A-DB79E3B4DB36'
      ON CONFLICT ("key") DO NOTHING
    `);

    // Idempotent raise only: never demote a user already at or above 50, and do not bump "updated"
    // when nothing changes. Scoped to the one sandbox kycHash.
    await queryRunner.query(`
      UPDATE "user_data"
      SET "kycLevel" = 50, "updated" = NOW()
      WHERE "kycHash" = '628CDA30-9E81-4294-997A-DB79E3B4DB36'
        AND "kycLevel" < 50
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Same guard as up(): restore only on dev. Early return still leaves the migration marked
    // reverted only when down() actually runs on dev — elsewhere the migration was a no-op on up
    // and stays a no-op here.
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // Restore only when a backup setting exists AND its origin marker is this migration's
    // timestamp. A foreign row with the same key but no/wrong marker must not drive the restore
    // (and is not deleted below). Without a matching marked row, do nothing — never write a
    // guessed default prior level.
    await queryRunner.query(`
      UPDATE "user_data"
      SET
        "kycLevel" = (
          SELECT split_part("value", '|', 1)::integer
          FROM "setting"
          WHERE "key" = 'sandboxKycLevelBackup:1785929412000:628CDA30-9E81-4294-997A-DB79E3B4DB36'
            AND split_part("value", '|', 2) = '1785929412000'
        ),
        "updated" = NOW()
      WHERE "kycHash" = '628CDA30-9E81-4294-997A-DB79E3B4DB36'
        AND EXISTS (
          SELECT 1
          FROM "setting"
          WHERE "key" = 'sandboxKycLevelBackup:1785929412000:628CDA30-9E81-4294-997A-DB79E3B4DB36'
            AND split_part("value", '|', 2) = '1785929412000'
        )
    `);

    // Only delete the setting this migration wrote (matching origin marker). Foreign same-key rows
    // without the marker stay in place.
    await queryRunner.query(`
      DELETE FROM "setting"
      WHERE "key" = 'sandboxKycLevelBackup:1785929412000:628CDA30-9E81-4294-997A-DB79E3B4DB36'
        AND split_part("value", '|', 2) = '1785929412000'
    `);
  }
};
