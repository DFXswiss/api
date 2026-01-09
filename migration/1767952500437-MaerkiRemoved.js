/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class MaerkiRemoved1767952500437 {
    name = 'MaerkiRemoved1767952500437'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_687dc858f7aff3f03ffbb214f2c"`);
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "maerkiBaumannEnable"`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ADD "maerkiBaumannEnable" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "country" ADD CONSTRAINT "DF_687dc858f7aff3f03ffbb214f2c" DEFAULT 0 FOR "maerkiBaumannEnable"`);
    }
}
