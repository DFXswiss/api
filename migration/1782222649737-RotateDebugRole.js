/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RotateDebugRole1782222649737 {
    name = 'RotateDebugRole1782222649737'

    /**
     * Grant DEBUG role to 0x57010249BE0e92c2f60944A026011DeA5Ea385A8
     * and revoke it from 0xF0009CD77CC4016a2FbC0D8fC6d3d74bE5999ac9.
     *
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`
            UPDATE "user"
            SET "role" = 'Debug'
            WHERE "address" = '0x57010249BE0e92c2f60944A026011DeA5Ea385A8'
        `);

        await queryRunner.query(`
            UPDATE "user"
            SET "role" = 'User'
            WHERE "address" = '0xF0009CD77CC4016a2FbC0D8fC6d3d74bE5999ac9'
              AND "role" = 'Debug'
        `);
    }

    /**
     * Revert: restore DEBUG role to old address, remove from new.
     *
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`
            UPDATE "user"
            SET "role" = 'Debug'
            WHERE "address" = '0xF0009CD77CC4016a2FbC0D8fC6d3d74bE5999ac9'
        `);

        await queryRunner.query(`
            UPDATE "user"
            SET "role" = 'User'
            WHERE "address" = '0x57010249BE0e92c2f60944A026011DeA5Ea385A8'
              AND "role" = 'Debug'
        `);
    }
}
