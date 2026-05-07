/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RefPayoutFrequency1772756747747 {
    name = 'RefPayoutFrequency1772756747747'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "refPayoutFrequency" nvarchar(256) NOT NULL CONSTRAINT "DF_925ad625277b6513eaee6172211" DEFAULT 'Daily'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_925ad625277b6513eaee6172211"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "refPayoutFrequency"`);
    }
}
