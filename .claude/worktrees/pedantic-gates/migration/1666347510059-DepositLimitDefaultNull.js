const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class DepositLimitDefaultNull1666347510059 {
    name = 'DepositLimitDefaultNull1666347510059'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "depositLimit" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_008a555620164eed6e1107d9814"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_008a555620164eed6e1107d9814" DEFAULT 90000 FOR "depositLimit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "depositLimit" float NOT NULL`);
    }
}
