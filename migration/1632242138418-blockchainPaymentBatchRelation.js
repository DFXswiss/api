const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class blockchainPaymentBatchRelation1632242138418 {
    name = 'blockchainPaymentBatchRelation1632242138418'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "blockchain_payment" ("id" int NOT NULL IDENTITY(1,1), "type" varchar(256) NOT NULL, "command" varchar(256) NOT NULL, "tx" varchar(256) NOT NULL, "assetValue" float, "updated" datetime2 NOT NULL CONSTRAINT "DF_2f755828cf0fe274535de8e3aee" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_46209c467ae685f94c105c0e040" DEFAULT getdate(), "assetId" int, "batchId" int, CONSTRAINT "PK_88f5f9ce418b05fe411449a5aa9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "blockchain_payment" ADD CONSTRAINT "FK_5dcbf96332c1cfd73efb740911a" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "blockchain_payment" ADD CONSTRAINT "FK_a2ebf353f9a69b1039245821e23" FOREIGN KEY ("batchId") REFERENCES "batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "blockchain_payment" DROP CONSTRAINT "FK_a2ebf353f9a69b1039245821e23"`);
        await queryRunner.query(`ALTER TABLE "blockchain_payment" DROP CONSTRAINT "FK_5dcbf96332c1cfd73efb740911a"`);
        await queryRunner.query(`DROP TABLE "blockchain_payment"`);
    }
}
