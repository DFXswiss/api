const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TransactionRequestUser1716895506387 {
    name = 'TransactionRequestUser1716895506387'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "userId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD CONSTRAINT "FK_0bb3e2fdbf16f7920ee4dabd06d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP CONSTRAINT "FK_0bb3e2fdbf16f7920ee4dabd06d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "userId"`);
    }
}
