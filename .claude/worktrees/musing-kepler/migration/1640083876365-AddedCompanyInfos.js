const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedCompanyInfos1640083876365 {
    name = 'AddedCompanyInfos1640083876365'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "accountType" nvarchar(256) NOT NULL CONSTRAINT "DF_625088799076cba7dffb9947942" DEFAULT 'Personal'`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationStreet" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationHouseNumber" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationLocation" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationZip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationCountryId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_039c54821427d0adca4db8de366" FOREIGN KEY ("organizationCountryId") REFERENCES ."country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_039c54821427d0adca4db8de366"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationCountryId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationZip"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationLocation"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationHouseNumber"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationStreet"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationName"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_625088799076cba7dffb9947942"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "accountType"`);
    }
}
