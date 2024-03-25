const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTradingRuleFeeAmount1711373597007 {
    name = 'addTradingRuleFeeAmount1711373597007'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" ADD "feeAmount" int NOT NULL CONSTRAINT "DF_11a56c1c554207561360c7488c7" DEFAULT 100`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP CONSTRAINT "DF_11a56c1c554207561360c7488c7"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP COLUMN "feeAmount"`);
    }
}
