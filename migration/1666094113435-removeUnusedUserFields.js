const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeUnusedUserFields1666094113435 {
    name = 'removeUnusedUserFields1666094113435'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_4aaf6d02199282eb8d3931bff31"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_0b294695467ceecc030f95461c1"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_039c54821427d0adca4db8de366"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_19ab0596b1fab6a44be5491ffb4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_45a8d297955d5c3896ea84afa4b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "isMigrated"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "mail"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "firstname"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "surname"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "street"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "houseNumber"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "location"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "zip"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "phone"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "countryId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "languageId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_625088799076cba7dffb9947942"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "accountType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationName"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationStreet"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationHouseNumber"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationLocation"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationZip"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "organizationCountryId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "currencyId"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "currencyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationCountryId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationZip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationLocation" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationHouseNumber" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationStreet" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "organizationName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "accountType" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_625088799076cba7dffb9947942" DEFAULT 'Personal' FOR "accountType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "languageId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "countryId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "phone" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "zip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "location" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "houseNumber" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "street" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "surname" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "firstname" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "mail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "isMigrated" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_45a8d297955d5c3896ea84afa4b" DEFAULT 1 FOR "isMigrated"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_19ab0596b1fab6a44be5491ffb4" FOREIGN KEY ("currencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_039c54821427d0adca4db8de366" FOREIGN KEY ("organizationCountryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_0b294695467ceecc030f95461c1" FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_4aaf6d02199282eb8d3931bff31" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
