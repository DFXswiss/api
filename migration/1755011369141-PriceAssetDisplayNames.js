/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PriceAssetDisplayNames1755011369141 {
    name = 'PriceAssetDisplayNames1755011369141'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "price_rule" ADD "assetDisplayName" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "price_rule" ADD "referenceDisplayName" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "price_rule" DROP COLUMN "referenceDisplayName"`);
        await queryRunner.query(`ALTER TABLE "price_rule" DROP COLUMN "assetDisplayName"`);
    }
}
