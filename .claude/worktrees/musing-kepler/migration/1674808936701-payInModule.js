const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class payInModule1674808936701 {
    name = 'payInModule1674808936701'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "txAssetRouteVout" ON "crypto_input"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.type", "purpose"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.vout", "txSequence"`);
        await queryRunner.query(`ALTER TABLE "deposit" ADD "key" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "status" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "prepareTxId" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "sendType" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "addressAddress" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "addressBlockchain" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "destinationAddressAddress" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "destinationAddressBlockchain" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "deposit" DROP CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_3e0f683d5bf0777f30b143db787"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_fd82f69592380d0a2bc557cf0d7"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "assetId" int`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "routeId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "deposit" ("address", "blockchain") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6aec38e5c6f47a65ffe49b2c2e" ON "crypto_input" ("inTxId", "assetId", "routeId", "txSequence") `);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_3e0f683d5bf0777f30b143db787" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_fd82f69592380d0a2bc557cf0d7" FOREIGN KEY ("routeId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_fd82f69592380d0a2bc557cf0d7"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_3e0f683d5bf0777f30b143db787"`);
        await queryRunner.query(`DROP INDEX "IDX_6aec38e5c6f47a65ffe49b2c2e" ON "crypto_input"`);
        await queryRunner.query(`DROP INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "deposit"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "routeId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ALTER COLUMN "assetId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_fd82f69592380d0a2bc557cf0d7" FOREIGN KEY ("routeId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_3e0f683d5bf0777f30b143db787" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deposit" ADD CONSTRAINT "UQ_e6bf1efaaed34dc4ee7c5de2ccc" UNIQUE ("address")`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "destinationAddressBlockchain"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "destinationAddressAddress"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "addressBlockchain"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "addressAddress"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "sendType"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "prepareTxId"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "status"`);
        await queryRunner.query(`ALTER TABLE "deposit" DROP COLUMN "key"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.txSequence", "vout"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.purpose", "type"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetRouteVout" ON "crypto_input" ("inTxId", "assetId", "routeId", "vout") `);
    }
}
