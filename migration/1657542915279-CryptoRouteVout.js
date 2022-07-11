const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoRouteVout1657542915279 {
    name = 'CryptoRouteVout1657542915279'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "txAssetRoute" ON "crypto_input"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "vout" int`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "outTxId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "blockHeight" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetRouteVout" ON "crypto_input" ("inTxId", "assetId", "routeId", "vout") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "txAssetRouteVout" ON "crypto_input"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "blockHeight" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "outTxId" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "vout"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetRoute" ON "crypto_input" ("inTxId", "assetId", "routeId") `);
    }
}
