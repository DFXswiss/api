/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddYapealEnable1765358591425 {
    name = 'AddYapealEnable1765358591425'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ADD "yapealEnable" bit NOT NULL CONSTRAINT "DF_b59578064ce6af190a982e279f5" DEFAULT 0`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_b59578064ce6af190a982e279f5"`);
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "yapealEnable"`);
    }
}
