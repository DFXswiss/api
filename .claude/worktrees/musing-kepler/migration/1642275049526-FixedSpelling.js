const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class FixedSpelling1642275049526 {
    name = 'FixedSpelling1642275049526'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "bank_data.bankname", "bankName"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "bank_data.bankName", "bankname"`);
    }
}
