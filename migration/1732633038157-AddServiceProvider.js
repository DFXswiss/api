const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddServiceProvider1732633038157 {
    name = 'AddServiceProvider1732633038157'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "service_provider" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_261f00d75ca243cf5c02f370d36" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_c03c8b1c2b306e9588ee66021f9" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "mail" nvarchar(256), "masterKey" nvarchar(256) NOT NULL, CONSTRAINT "PK_7610a92ca242cb29d96009caa19" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user" ADD "serviceProviderId" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_10baebd5387ca8c1140200f8f2c" FOREIGN KEY ("serviceProviderId") REFERENCES "service_provider"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_10baebd5387ca8c1140200f8f2c"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "serviceProviderId"`);
        await queryRunner.query(`DROP TABLE "service_provider"`);
    }
}
