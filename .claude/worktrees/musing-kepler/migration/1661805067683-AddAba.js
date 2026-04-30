const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAba1661805067683 {
    name = 'AddAba1661805067683'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "aba" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "aba"`);
    }
}
