const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedBankData1631376454040 {
    name = 'AddedBankData1631376454040'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_07524cd9a17d5d9aba78c93a35f"`);
        await queryRunner.query(`DROP INDEX "nameLocation" ON "dbo"."user_data"`);
        await queryRunner.query(`CREATE TABLE "bank_data" ("id" int NOT NULL IDENTITY(1,1), "name" varchar(256) NOT NULL, "location" varchar(256) NOT NULL, "country" varchar(256), "updated" datetime2 NOT NULL CONSTRAINT "DF_27c7db7029bd7b3274befd43b09" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8b107733e865e16542a5e974a57" DEFAULT getdate(), "userDataId" int, CONSTRAINT "PK_4d353142a69ee41d42e6b8c8c8a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocation" ON "bank_data" ("name", "location") `);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "location"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "countryId"`);
        await queryRunner.query(`ALTER TABLE "bank_data" ADD CONSTRAINT "FK_faf8d8f795f788cac5aa079b2fa" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_data" DROP CONSTRAINT "FK_faf8d8f795f788cac5aa079b2fa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "countryId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "location" varchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "name" varchar(256) NOT NULL`);
        await queryRunner.query(`DROP INDEX "nameLocation" ON "bank_data"`);
        await queryRunner.query(`DROP TABLE "bank_data"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocation" ON "dbo"."user_data" ("name", "location") `);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_07524cd9a17d5d9aba78c93a35f" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
