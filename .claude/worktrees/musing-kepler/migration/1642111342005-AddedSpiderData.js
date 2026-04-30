const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedSpiderData1642111342005 {
    name = 'AddedSpiderData1642111342005'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_1753b4eb3cad58e852fe06b9815"`);
        await queryRunner.query(`DROP INDEX "REL_1753b4eb3cad58e852fe06b981" ON "dbo"."user_data"`);
        await queryRunner.query(`CREATE TABLE "spider_data" ("id" int NOT NULL IDENTITY(1,1), "url" nvarchar(256) NOT NULL, "version" nvarchar(256) NOT NULL, "result" nvarchar(MAX), "userDataId" int NOT NULL, CONSTRAINT "PK_f6643ff6ada200af4826da510d8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_a596f387f21d50197370fdb492" ON "spider_data" ("userDataId") WHERE "userDataId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "riskState" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionAmount" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionCurrency" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "plannedContribution" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "spider_data" ADD CONSTRAINT "FK_a596f387f21d50197370fdb492f" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "spider_data" DROP CONSTRAINT "FK_a596f387f21d50197370fdb492f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "plannedContribution"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionCurrency"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "riskState"`);
        await queryRunner.query(`DROP INDEX "REL_a596f387f21d50197370fdb492" ON "spider_data"`);
        await queryRunner.query(`DROP TABLE "spider_data"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_1753b4eb3cad58e852fe06b981" ON "dbo"."user_data" ("kycFileId") WHERE ([kycFileId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_1753b4eb3cad58e852fe06b9815" FOREIGN KEY ("kycFileId") REFERENCES "kyc_file"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
