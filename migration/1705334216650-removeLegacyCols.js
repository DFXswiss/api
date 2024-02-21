const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeLegacyCols1705334216650 {
    name = 'removeLegacyCols1705334216650'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_60bd28d72a4a06f3b412e615058"`);
        await queryRunner.query(`DROP INDEX "REL_60bd28d72a4a06f3b412e61505" ON "dbo"."user_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_ab257bb00ad8dfb36f58752d4b9"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycState"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "mainBankDataId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "plannedContribution"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycCustomerId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycStatusChangeDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contribution"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "riskRoots"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "riskRoots" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contribution" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycStatusChangeDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycCustomerId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "plannedContribution" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "mainBankDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycState" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_ab257bb00ad8dfb36f58752d4b9" DEFAULT 'NA' FOR "kycState"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_60bd28d72a4a06f3b412e61505" ON "dbo"."user_data" ("mainBankDataId") WHERE ([mainBankDataId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_60bd28d72a4a06f3b412e615058" FOREIGN KEY ("mainBankDataId") REFERENCES "bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
