const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankDataActive1733762279358 {
    name = 'addBankDataActive1733762279358'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "active" bit NOT NULL CONSTRAINT "DF_dfe568e239bb915e3f4d75b198e" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP CONSTRAINT "DF_dfe568e239bb915e3f4d75b198e"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "active"`);
    }
}
