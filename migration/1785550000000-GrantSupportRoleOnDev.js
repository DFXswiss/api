/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class GrantSupportRoleOnDev1785550000000 {
  name = 'GrantSupportRoleOnDev1785550000000';

  /**
   * Grant Support role to 0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8 on DEV only,
   * and only when the user currently has the User role.
   * Update and audit log insert run in one statement so a failed audit aborts the role change
   * (fail-closed, CONTRIBUTING auditable mutations).
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // DEV-only: this grant is scoped to the DEV environment. Whether the same
    // address exists elsewhere is unchecked; never elevate roles outside DEV.
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(`
            WITH updated AS (
                UPDATE "user"
                SET "role" = 'Support'
                WHERE LOWER("address") = LOWER('0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8')
                  AND "role" = 'User'
                RETURNING id
            )
            INSERT INTO "log" ("system", "subsystem", "severity", "message", "category")
            SELECT
                'Auth',
                'GrantSupportRoleOnDev',
                'Info',
                jsonb_build_object(
                    'migration', 'GrantSupportRoleOnDev1785550000000',
                    'direction', 'up',
                    'affectedCount', count(*),
                    'userIds', string_agg(id::text, ','),
                    'fromRole', 'User',
                    'toRole', 'Support'
                )::text,
                'up'
            FROM updated
        `);
  }

  /**
   * Revert: restore User role for the same address, only if currently Support and only when
   * up() actually promoted a row (audit log affectedCount > 0).
   * Update and audit log insert run in one statement so a failed audit aborts the role change
   * (fail-closed, CONTRIBUTING auditable mutations).
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // DEV-only: mirror the up() environment gate so down() never touches other envs.
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(`
            WITH updated AS (
                UPDATE "user"
                SET "role" = 'User'
                WHERE LOWER("address") = LOWER('0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8')
                  AND "role" = 'Support'
                  AND EXISTS (
                      SELECT 1 FROM "log"
                      WHERE "system" = 'Auth'
                        AND "subsystem" = 'GrantSupportRoleOnDev'
                        AND "category" = 'up'
                        AND ("message"::jsonb ->> 'affectedCount')::int > 0
                  )
                RETURNING id
            )
            INSERT INTO "log" ("system", "subsystem", "severity", "message", "category")
            SELECT
                'Auth',
                'GrantSupportRoleOnDev',
                'Info',
                jsonb_build_object(
                    'migration', 'GrantSupportRoleOnDev1785550000000',
                    'direction', 'down',
                    'affectedCount', count(*),
                    'userIds', string_agg(id::text, ','),
                    'fromRole', 'Support',
                    'toRole', 'User'
                )::text,
                'down'
            FROM updated
        `);
  }
};
