const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserDataHasBankTx1755210668596 {
    name = 'AddUserDataHasBankTx1755210668596'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "hasBankTx" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "hasBankTx"`);
    }
}
