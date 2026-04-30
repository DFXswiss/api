const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTransactionRequestUidUnique1737629409528 {
    name = 'addTransactionRequestUidUnique1737629409528'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ALTER COLUMN "uid" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD CONSTRAINT "UQ_03972d762f97485fb1af691d178" UNIQUE ("uid")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP CONSTRAINT "UQ_03972d762f97485fb1af691d178"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ALTER COLUMN "uid" nvarchar(256)`);
    }
}
