const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCustodyBalanceTable1745591390587 {
    name = 'AddCustodyBalanceTable1745591390587'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "custody_balance" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_9649e260d0b5483308abbd8551e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_0c0929832c0421add872f66caf9" DEFAULT getdate(), "balance" float NOT NULL CONSTRAINT "DF_c3605bbe41937b0b1aa67b0d9b2" DEFAULT 0, "userId" int NOT NULL, "assetId" int NOT NULL, CONSTRAINT "PK_6fb82d39c6a4f8829f5ae32ae5c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_325f7bc856ac5799a1ae9c2d39" ON "custody_balance" ("userId", "assetId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "approxPriceEur" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "inputAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "outputAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "amountInChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "inputAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "outputAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "sellId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "swapId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "buyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_553f9007365042c17f4f3925fc6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ALTER COLUMN "transactionRequestId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_1620f9da4ce2f0170568695bd6" ON "dbo"."custody_order" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_7d62f2c3c882c96f304248d5040" FOREIGN KEY ("inputAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_1266fd622493e124f900d1fc1b6" FOREIGN KEY ("outputAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_1e3a1e7be98dcdf6ce708731358" FOREIGN KEY ("sellId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_dddd3128d7ea93c8b026663e488" FOREIGN KEY ("swapId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_ff9ef9c9ddfd4f824991754d6cd" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_553f9007365042c17f4f3925fc6" FOREIGN KEY ("transactionRequestId") REFERENCES "transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_1620f9da4ce2f0170568695bd6b" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_balance" ADD CONSTRAINT "FK_12039297cf2fb30625f423f548d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_balance" ADD CONSTRAINT "FK_235417a8c4f430e453eae063796" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "custody_balance" DROP CONSTRAINT "FK_235417a8c4f430e453eae063796"`);
        await queryRunner.query(`ALTER TABLE "custody_balance" DROP CONSTRAINT "FK_12039297cf2fb30625f423f548d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_1620f9da4ce2f0170568695bd6b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_553f9007365042c17f4f3925fc6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_ff9ef9c9ddfd4f824991754d6cd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_dddd3128d7ea93c8b026663e488"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_1e3a1e7be98dcdf6ce708731358"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_1266fd622493e124f900d1fc1b6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP CONSTRAINT "FK_7d62f2c3c882c96f304248d5040"`);
        await queryRunner.query(`DROP INDEX "REL_1620f9da4ce2f0170568695bd6" ON "dbo"."custody_order"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ALTER COLUMN "transactionRequestId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" ADD CONSTRAINT "FK_553f9007365042c17f4f3925fc6" FOREIGN KEY ("transactionRequestId") REFERENCES "transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "buyId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "swapId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "sellId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "outputAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "inputAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "amountInChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "outputAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."custody_order" DROP COLUMN "inputAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "approxPriceEur"`);
        await queryRunner.query(`DROP INDEX "IDX_325f7bc856ac5799a1ae9c2d39" ON "custody_balance"`);
        await queryRunner.query(`DROP TABLE "custody_balance"`);
    }
}
