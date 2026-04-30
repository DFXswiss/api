const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangeSpecialCode1731963190430 {
    name = 'ChangeSpecialCode1731963190430'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "dbo.fee.discountCode", "specialCode"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "dbo.fee.specialCode", "discountCode"`);
    }
}
