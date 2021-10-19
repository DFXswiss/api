const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedBlockcchainPayment1634018813862 {
    name = 'AddedBlockcchainPayment1634018813862'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "blockchain_payment" ("id" int NOT NULL IDENTITY(1,1), "type" nvarchar(256) NOT NULL, "command" nvarchar(256) NOT NULL, "tx" nvarchar(256) NOT NULL, "assetValue" float, "updated" datetime2 NOT NULL CONSTRAINT "DF_2f755828cf0fe274535de8e3aee" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_46209c467ae685f94c105c0e040" DEFAULT getdate(), "assetId" int, "batchId" int, CONSTRAINT "PK_88f5f9ce418b05fe411449a5aa9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD "batchId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD "batchId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD "batchId" int`);
        await queryRunner.query(`DROP INDEX "nameLocationIban" ON "dbo"."bank_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "iban" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" DROP CONSTRAINT "UQ_85fde1bea0b040ee9d132677d50"`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" ADD "name" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" ADD CONSTRAINT "UQ_85fde1bea0b040ee9d132677d50" UNIQUE ("name")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocationIban" ON "dbo"."bank_data" ("name", "location", "iban") `);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD CONSTRAINT "FK_f5ab6b9b1fa1609c80d7e014a41" FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "FK_19a60567905e8cc8b38fa84cdd8" FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD CONSTRAINT "FK_c134dedcaec7dd45770b0504181" FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "blockchain_payment" ADD CONSTRAINT "FK_5dcbf96332c1cfd73efb740911a" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "blockchain_payment" ADD CONSTRAINT "FK_a2ebf353f9a69b1039245821e23" FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "blockchain_payment" DROP CONSTRAINT "FK_a2ebf353f9a69b1039245821e23"`);
        await queryRunner.query(`ALTER TABLE "blockchain_payment" DROP CONSTRAINT "FK_5dcbf96332c1cfd73efb740911a"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "FK_c134dedcaec7dd45770b0504181"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "FK_19a60567905e8cc8b38fa84cdd8"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "FK_f5ab6b9b1fa1609c80d7e014a41"`);
        await queryRunner.query(`DROP INDEX "nameLocationIban" ON "dbo"."bank_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" DROP CONSTRAINT "UQ_85fde1bea0b040ee9d132677d50"`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" ADD "name" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."batch" ADD CONSTRAINT "UQ_85fde1bea0b040ee9d132677d50" UNIQUE ("name")`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "iban" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocationIban" ON "dbo"."bank_data" ("name", "location", "iban") `);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP COLUMN "batchId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP COLUMN "batchId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP COLUMN "batchId"`);
        await queryRunner.query(`DROP TABLE "blockchain_payment"`);
    }
}
