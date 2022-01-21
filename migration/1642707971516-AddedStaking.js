const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedStaking1642707971516 {
    name = 'AddedStaking1642707971516'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "FK_8ca9429a424c15ce5e6ce104b17"`);
        await queryRunner.query(`DROP INDEX "txAssetSell" ON "dbo"."crypto_input"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.sellId", "routeId"`);
        await queryRunner.query(`CREATE TABLE "deposit_route" ("id" int NOT NULL IDENTITY(1,1), "active" bit NOT NULL CONSTRAINT "DF_21d5621f40c7f079e73673531e4" DEFAULT 1, "updated" datetime2 NOT NULL CONSTRAINT "DF_73d5afd956e896486ca64941ecd" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_be652a0aadbe32a323f51a3f204" DEFAULT getdate(), "iban" nvarchar(256), "volume" float CONSTRAINT "DF_4ac7315ecc23addc7e2dc38c950" DEFAULT 0, "type" nvarchar(255) NOT NULL, "depositId" int NOT NULL, "rewardDepositId" int, "paybackDepositId" int, "userId" int NOT NULL, "fiatId" int, CONSTRAINT "PK_4bd70324900c001c27c92e50ef9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_bd121427197738f2c95231fb8e" ON "deposit_route" ("depositId") WHERE "depositId" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_eeade62dbb7199e73b79c27e63" ON "deposit_route" ("type") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetRoute" ON "dbo"."crypto_input" ("inTxId", "assetId", "routeId") `);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD CONSTRAINT "FK_bd121427197738f2c95231fb8e4" FOREIGN KEY ("depositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD CONSTRAINT "FK_0240361c288231f5c697271961a" FOREIGN KEY ("rewardDepositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD CONSTRAINT "FK_eed4136fa591f383d1079b1902f" FOREIGN KEY ("paybackDepositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD CONSTRAINT "FK_416688df9433a5db75efe220cc1" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deposit_route" ADD CONSTRAINT "FK_6538dff053863dce6b4b8c507fb" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`SET IDENTITY_INSERT dbo.deposit_route ON; INSERT INTO dbo.deposit_route (id, iban, active, updated, created, fiatId, depositId, userId, volume, type) SELECT id, iban, active, updated, created, fiatId, depositId, userId, volume, 'Sell' FROM dbo.sell; SET IDENTITY_INSERT dbo.deposit_route OFF`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "FK_fd82f69592380d0a2bc557cf0d7" FOREIGN KEY ("routeId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "FK_fd82f69592380d0a2bc557cf0d7"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "FK_6538dff053863dce6b4b8c507fb"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "FK_416688df9433a5db75efe220cc1"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "FK_eed4136fa591f383d1079b1902f"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "FK_0240361c288231f5c697271961a"`);
        await queryRunner.query(`ALTER TABLE "deposit_route" DROP CONSTRAINT "FK_bd121427197738f2c95231fb8e4"`);
        await queryRunner.query(`DROP INDEX "txAssetRoute" ON "dbo"."crypto_input"`);
        await queryRunner.query(`DROP INDEX "IDX_eeade62dbb7199e73b79c27e63" ON "deposit_route"`);
        await queryRunner.query(`DROP INDEX "REL_bd121427197738f2c95231fb8e" ON "deposit_route"`);
        await queryRunner.query(`DROP TABLE "deposit_route"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.routeId", "sellId"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetSell" ON "dbo"."crypto_input" ("inTxId", "assetId", "sellId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "FK_8ca9429a424c15ce5e6ce104b17" FOREIGN KEY ("sellId") REFERENCES "sell"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
