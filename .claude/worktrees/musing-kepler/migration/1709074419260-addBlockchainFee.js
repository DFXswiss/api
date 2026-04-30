const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBlockchainFee1709074419260 {
    name = 'addBlockchainFee1709074419260'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "blockchain_fee" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_56b3adfe33601b4df0ca503d1e6" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_893f0d46a83abd204cc460b7207" DEFAULT getdate(), "amount" float NOT NULL, "assetId" int NOT NULL, CONSTRAINT "PK_08f48c1eea275d0ce8f855eaa99" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_a28a800539e5cf4d87a14e90d2" ON "blockchain_fee" ("assetId") WHERE "assetId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "blockchain_fee" ADD CONSTRAINT "FK_a28a800539e5cf4d87a14e90d25" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "blockchain_fee" DROP CONSTRAINT "FK_a28a800539e5cf4d87a14e90d25"`);
        await queryRunner.query(`DROP INDEX "REL_a28a800539e5cf4d87a14e90d2" ON "blockchain_fee"`);
        await queryRunner.query(`DROP TABLE "blockchain_fee"`);
    }
}
