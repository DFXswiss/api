/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRefAsset1768344360851 {
    name = 'AddRefAsset1768344360851'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "refAssetId" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_20e823fee19baff0c5090ab72df" FOREIGN KEY ("refAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_20e823fee19baff0c5090ab72df"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "refAssetId"`);
    }
}
