const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newFeeCol1651145926011 {
    name = 'newFeeCol1651145926011'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.fee", "feePercent"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.feePercent", "fee"`);
    }
}
