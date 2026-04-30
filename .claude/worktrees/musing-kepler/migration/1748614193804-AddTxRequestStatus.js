const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddTxRequestStatus1748614193804 {
    name = 'AddTxRequestStatus1748614193804'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "status" nvarchar(256) NOT NULL CONSTRAINT "DF_4932fe474708ae92b539900a0c3" DEFAULT 'Created'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP CONSTRAINT "DF_4932fe474708ae92b539900a0c3"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "status"`);
    }
}
