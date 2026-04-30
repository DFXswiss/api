const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TransactionRequestUserNotNull1716910408337 {
    name = 'TransactionRequestUserNotNull1716910408337'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP CONSTRAINT "FK_0bb3e2fdbf16f7920ee4dabd06d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ALTER COLUMN "userId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD CONSTRAINT "FK_0bb3e2fdbf16f7920ee4dabd06d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP CONSTRAINT "FK_0bb3e2fdbf16f7920ee4dabd06d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ALTER COLUMN "userId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD CONSTRAINT "FK_0bb3e2fdbf16f7920ee4dabd06d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
