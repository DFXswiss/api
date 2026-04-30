const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTradingRulePoolFee1711386769485 {
    name = 'addTradingRulePoolFee1711386769485'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" ADD "poolFee" int NOT NULL CONSTRAINT "DF_37917c80864f5d0dc108030fcef" DEFAULT 100`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP CONSTRAINT "DF_37917c80864f5d0dc108030fcef"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP COLUMN "poolFee"`);
    }
}
