const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RenameBankDataCols1727885942716 {
    name = 'RenameBankDataCols1727885942716'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "bank_data.active", "approved"`);
        await queryRunner.query(`EXEC sp_rename "bank_data.manualCheck", "manualApproved"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "bank_data.manualApproved", "manualCheck"`);
        await queryRunner.query(`EXEC sp_rename "bank_data.approved", "active"`);
    }
}
