const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankDataComment1716378941373 {
    name = 'addBankDataComment1716378941373'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "comment" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "comment"`);
    }
}
