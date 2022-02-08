const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedBuyStaking1643464750617 {
    name = 'AddedBuyStaking1643464750617'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanAssetUser" ON "dbo"."buy"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "depositId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAssetDepositUser" ON "dbo"."buy" ("iban", "assetId", "depositId", "userId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_ce6a9309b2dac5acbc26f8eadbc" FOREIGN KEY ("depositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_ce6a9309b2dac5acbc26f8eadbc"`);
        await queryRunner.query(`DROP INDEX "ibanAssetDepositUser" ON "dbo"."buy"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "depositId"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAssetUser" ON "dbo"."buy" ("iban", "assetId", "userId") `);
    }
}
