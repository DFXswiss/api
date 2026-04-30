const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedMainBankData1638442520666 {
    name = 'AddedMainBankData1638442520666'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "mainBankDataId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_60bd28d72a4a06f3b412e61505" ON "dbo"."user_data" ("mainBankDataId") WHERE "mainBankDataId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_60bd28d72a4a06f3b412e615058" FOREIGN KEY ("mainBankDataId") REFERENCES ."bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_60bd28d72a4a06f3b412e615058"`);
        await queryRunner.query(`DROP INDEX "REL_60bd28d72a4a06f3b412e61505" ON "dbo"."user_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "mainBankDataId"`);
    }
}
