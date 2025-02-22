const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddOrganizationTable1739880957294 {
    name = 'AddOrganizationTable1739880957294'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "organization" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_a2964ac3a5de8cd45fc6b39f7f5" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_250b754e2e003ae16d59f39b787" DEFAULT getdate(), "name" nvarchar(256), "street" nvarchar(256), "houseNumber" nvarchar(256), "location" nvarchar(256), "zip" nvarchar(256), "allBeneficialOwnersName" nvarchar(256), "allBeneficialOwnersDomicile" nvarchar(256), "accountOpenerAuthorization" nvarchar(256), "complexOrgStructure" bit, "legalEntity" nvarchar(256), "signatoryPower" nvarchar(256), "accountOpenerId" int, "countryId" int, CONSTRAINT "PK_472c1f99a32def1b0abb219cd67" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "organizationId" int`);
        await queryRunner.query(`ALTER TABLE "organization" ADD CONSTRAINT "FK_a8300a9cc86e506ebe73fed7896" FOREIGN KEY ("accountOpenerId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "organization" ADD CONSTRAINT "FK_96b784c2e08bc1ee69fc1e3c2ab" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_692d0b671f0e36d1b8cfe62549a" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_692d0b671f0e36d1b8cfe62549a"`);
        await queryRunner.query(`ALTER TABLE "organization" DROP CONSTRAINT "FK_96b784c2e08bc1ee69fc1e3c2ab"`);
        await queryRunner.query(`ALTER TABLE "organization" DROP CONSTRAINT "FK_a8300a9cc86e506ebe73fed7896"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "organizationId"`);
        await queryRunner.query(`DROP TABLE "organization"`);
    }
}
