const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeUnusedBankDataCols1668435876824 {
    name = 'removeUnusedBankDataCols1668435876824'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "nameLocationIban" ON "dbo"."bank_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "location"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "country"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "bankName"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "bic"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "active" bit NOT NULL CONSTRAINT "DF_dfe568e239bb915e3f4d75b198e" DEFAULT 1`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocationIban" ON "dbo"."bank_data" ("name", "iban") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "nameLocationIban" ON "dbo"."bank_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP CONSTRAINT "DF_dfe568e239bb915e3f4d75b198e"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "active"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "bic" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "bankName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "country" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "location" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameLocationIban" ON "dbo"."bank_data" ("name", "location", "iban") `);
    }
}
