const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTransactionRequestUid1736952747456 {
    name = 'addTransactionRequestUid1736952747456'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "uid" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "transactionRequestId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD CONSTRAINT "FK_435dd154dd468fac77ba8436683" FOREIGN KEY ("transactionRequestId") REFERENCES "transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP CONSTRAINT "FK_435dd154dd468fac77ba8436683"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "transactionRequestId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "uid"`);
    }
}
