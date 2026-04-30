const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankDataType1702910132205 {
    name = 'addBankDataType1702910132205'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "type" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "type"`);
    }
}
