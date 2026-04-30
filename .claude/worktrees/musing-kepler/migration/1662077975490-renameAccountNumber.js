const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class renameAccountNumber1662077975490 {
    name = 'renameAccountNumber1662077975490'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "bank_account.acountNumber", "accountNumber"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "bank_account.accountNumber", "acountNumber"`);
    }
}
