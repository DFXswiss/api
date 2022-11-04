const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class limitRequestMail1666018992624 {
    name = 'limitRequestMail1666018992624'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "recipientMail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "mailSendDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "recipientMail"`);
    }
}
