/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRefAsset1768344518359 {
    name = 'AddRefAsset1768344518359'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ADD "refEnabled" bit NOT NULL CONSTRAINT "DF_d2c85e8cbdbff07a1dcd8d17797" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "refAssetId" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_20e823fee19baff0c5090ab72df" FOREIGN KEY ("refAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_20e823fee19baff0c5090ab72df"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "refAssetId"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_d2c85e8cbdbff07a1dcd8d17797"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "refEnabled"`);
    }
}
