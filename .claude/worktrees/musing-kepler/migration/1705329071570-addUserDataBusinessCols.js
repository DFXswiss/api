const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataBusinessCols1705329071570 {
    name = 'addUserDataBusinessCols1705329071570'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "totalVolumeChfAuditPeriod" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "allBeneficialOwnersName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "allBeneficialOwnersDomicile" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "accountOpenerAuthorization" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "accountOpenerId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_8f119df333e0f6a70aac06f0d4" ON "dbo"."user_data" ("accountOpenerId") WHERE "accountOpenerId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_8f119df333e0f6a70aac06f0d4f" FOREIGN KEY ("accountOpenerId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_8f119df333e0f6a70aac06f0d4f"`);
        await queryRunner.query(`DROP INDEX "REL_8f119df333e0f6a70aac06f0d4" ON "dbo"."user_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "accountOpenerId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "accountOpenerAuthorization"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "allBeneficialOwnersDomicile"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "allBeneficialOwnersName"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "totalVolumeChfAuditPeriod"`);
    }
}
