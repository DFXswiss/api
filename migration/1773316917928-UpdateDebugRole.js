/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class UpdateDebugRole1773316917928 {
    name = 'UpdateDebugRole1773316917928'

    /**
     * Grant DEBUG role to 0xF0009CD77CC4016a2FbC0D8fC6d3d74bE5999ac9
     * and remove DEBUG role from 0x65137510d6Df01083f5032B77B04632681f09e7C.
     *
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`
            UPDATE "dbo"."user"
            SET "role" = 'Debug'
            WHERE "address" = '0xF0009CD77CC4016a2FbC0D8fC6d3d74bE5999ac9'
        `);

        await queryRunner.query(`
            UPDATE "dbo"."user"
            SET "role" = 'User'
            WHERE "address" = '0x65137510d6Df01083f5032B77B04632681f09e7C'
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
            UPDATE "dbo"."user"
            SET "role" = 'Debug'
            WHERE "address" = '0x65137510d6Df01083f5032B77B04632681f09e7C'
        `);

        await queryRunner.query(`
            UPDATE "dbo"."user"
            SET "role" = 'User'
            WHERE "address" = '0xF0009CD77CC4016a2FbC0D8fC6d3d74bE5999ac9'
              AND "role" = 'Debug'
        `);
    }
}
