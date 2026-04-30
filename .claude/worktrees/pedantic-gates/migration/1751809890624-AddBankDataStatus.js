const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBankDataStatus1751809890624 {
    name = 'AddBankDataStatus1751809890624'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "status" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "status"`);
    }
}
