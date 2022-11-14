const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddFiatOutput1668433925914 {
    name = 'AddFiatOutput1668433925914'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "fiat_output" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_143e2cf41873a241bfe7ebf1040" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8bde4905c96434aeabda03651f2" DEFAULT getdate(), "reason" nvarchar(256), CONSTRAINT "PK_e7c5644857052228326a634b4f3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "fiatOutputId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_5669e232b56be7b85df413b784" ON "buy_fiat" ("fiatOutputId") WHERE "fiatOutputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD CONSTRAINT "FK_5669e232b56be7b85df413b7845" FOREIGN KEY ("fiatOutputId") REFERENCES "fiat_output"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP CONSTRAINT "FK_5669e232b56be7b85df413b7845"`);
        await queryRunner.query(`DROP INDEX "REL_5669e232b56be7b85df413b784" ON "buy_fiat"`);
         await queryRunner.query(`DROP TABLE "fiat_output"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ADD CONSTRAINT "FK_88516904512221a608f408dadaf" FOREIGN KEY ("feeReferenceAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
