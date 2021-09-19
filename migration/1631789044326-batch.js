const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class batch1631789044326 {
    name = 'batch1631789044326'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "nameLocation" ON "dbo"."bank_data"`);
        await queryRunner.query(`CREATE TABLE "batch" ("id" int NOT NULL IDENTITY(1,1), "name" varchar(256) NOT NULL, "balanceBefore" float, "balanceAfter" float, "updated" datetime2 NOT NULL CONSTRAINT "DF_bffd7c41acdefb8b0f5cc1c0070" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8f67957c2c50546477cf7f465d5" DEFAULT getdate(), CONSTRAINT "UQ_85fde1bea0b040ee9d132677d50" UNIQUE ("name"), CONSTRAINT "PK_57da3b830b57bec1fd329dcaf43" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "iban" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "location" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocationIban" ON "dbo"."bank_data" ("name", "location", "iban") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "nameLocationIban" ON "dbo"."bank_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "location" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "iban"`);
        await queryRunner.query(`DROP TABLE "batch"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocation" ON "dbo"."bank_data" ("name", "location") `);
    }
}
