const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class MovedUserData1641998536589 {
    name = 'MovedUserData1641998536589'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_b17cea654b3115f102f42e4576c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "refFeeAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "isMigrated" bit NOT NULL CONSTRAINT "DF_45a8d297955d5c3896ea84afa4b" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "accountType" nvarchar(256) NOT NULL CONSTRAINT "DF_ce7df347a5849ff214864a8621b" DEFAULT 'Personal'`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "mail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "firstname" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "surname" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "street" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "houseNumber" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "location" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "zip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "organizationName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "organizationStreet" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "organizationHouseNumber" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "organizationLocation" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "organizationZip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "phone" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "countryId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "organizationCountryId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "languageId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_07524cd9a17d5d9aba78c93a35f" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_fd9f1c6157c0cafaa6557c05235" FOREIGN KEY ("organizationCountryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_2e6642ec09da8e0da57dfed3389" FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_2e6642ec09da8e0da57dfed3389"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_fd9f1c6157c0cafaa6557c05235"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_07524cd9a17d5d9aba78c93a35f"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "languageId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "organizationCountryId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "countryId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "phone"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "organizationZip"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "organizationLocation"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "organizationHouseNumber"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "organizationStreet"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "organizationName"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "zip"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "location"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "houseNumber"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "street"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "surname"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "firstname"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "mail"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_ce7df347a5849ff214864a8621b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "accountType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_45a8d297955d5c3896ea84afa4b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "isMigrated"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "refFeeAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_b17cea654b3115f102f42e4576c" FOREIGN KEY ("refFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
