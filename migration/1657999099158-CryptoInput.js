const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoInput1657999099158 {
    name = 'CryptoInput1657999099158'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "txAssetRoute" ON "crypto_input"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "vout" int`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "cryptoInputId" int`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "cryptoRouteId" int`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "outTxId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "blockHeight" int`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ALTER COLUMN "buyId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetRouteVout" ON "crypto_input" ("inTxId", "assetId", "routeId", "vout") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_934067e388921275e05a666358" ON "buy_crypto" ("cryptoInputId") WHERE "cryptoInputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_934067e388921275e05a666358c" FOREIGN KEY ("cryptoInputId") REFERENCES "crypto_input"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_8de69d901e2d2949e23d550c016" FOREIGN KEY ("cryptoRouteId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_8de69d901e2d2949e23d550c016"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_934067e388921275e05a666358c"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f"`);
        await queryRunner.query(`DROP INDEX "REL_934067e388921275e05a666358" ON "buy_crypto"`);
        await queryRunner.query(`DROP INDEX "txAssetRouteVout" ON "crypto_input"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ALTER COLUMN "buyId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "blockHeight" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "outTxId" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "cryptoRouteId"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "cryptoInputId"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "vout"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetRoute" ON "crypto_input" ("inTxId", "assetId", "routeId") `);
    }
}
