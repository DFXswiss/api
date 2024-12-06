const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCustodyProvider1732636815181 {
    name = 'AddCustodyProvider1732636815181'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "custody_provider" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_4c517704c6d3655e5c25e43004f" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_1e0075b52d49d3e4bd70c769083" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "mail" nvarchar(256), "masterKey" nvarchar(256) NOT NULL, CONSTRAINT "UQ_bbcc35eef4c8af9a3f5fa740a08" UNIQUE ("masterKey"), CONSTRAINT "PK_1d423bcbd82372286f8b1cdb8d6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyProviderId" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "FK_316fdc0ecba8febcd28417fe548" FOREIGN KEY ("custodyProviderId") REFERENCES "custody_provider"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "FK_316fdc0ecba8febcd28417fe548"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyProviderId"`);
        await queryRunner.query(`DROP TABLE "custody_provider"`);
    }
}
