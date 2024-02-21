const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addCryptoInputReturnMail1691067451904 {
    name = 'addCryptoInputReturnMail1691067451904'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "recipientMail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "mailReturnSendDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "mailReturnSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "recipientMail"`);
    }
}
