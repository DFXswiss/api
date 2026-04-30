const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBankAmlEnabled1738595868385 {
    name = 'AddBankAmlEnabled1738595868385'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank" ADD "amlEnabled" bit NOT NULL CONSTRAINT "DF_a156dae52ebea2502c1df6a6ea9" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank" DROP CONSTRAINT "DF_a156dae52ebea2502c1df6a6ea9"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank" DROP COLUMN "amlEnabled"`);
    }
}
