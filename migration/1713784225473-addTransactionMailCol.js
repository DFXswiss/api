const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTransactionMailCol1713784225473 {
    name = 'addTransactionMailCol1713784225473'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "recipientMail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "mailSendDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "recipientMail"`);
    }
}
