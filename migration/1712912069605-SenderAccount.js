const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SenderAccount1712912069605 {
    name = 'SenderAccount1712912069605'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "senderAccount" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "senderAccount"`);
    }
}
