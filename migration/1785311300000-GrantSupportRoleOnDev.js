/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class GrantSupportRoleOnDev1785311300000 {
  name = 'GrantSupportRoleOnDev1785311300000';

  /**
   * Grant Support role to 0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8 on DEV only,
   * and only when the user currently has the User role.
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // DEV-only: this grant is scoped to the DEV environment. Whether the same
    // address exists elsewhere is unchecked; never elevate roles outside DEV.
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(`
            UPDATE "user"
            SET "role" = 'Support'
            WHERE LOWER("address") = LOWER('0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8')
              AND "role" = 'User'
        `);
  }

  /**
   * Revert: restore User role for the same address, only if currently Support.
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // DEV-only: mirror the up() environment gate so down() never touches other envs.
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(`
            UPDATE "user"
            SET "role" = 'User'
            WHERE LOWER("address") = LOWER('0xB6cA05F0e3e71B1C5568BD423A6682dc78469Ae8')
              AND "role" = 'Support'
        `);
  }
};
