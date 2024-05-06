const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TradingRuleTargets1714983022675 {
    name = 'TradingRuleTargets1714983022675'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" ADD "lowerTarget" float NOT NULL CONSTRAINT "DF_aa6aa524dad155482ada19767c3" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" ADD "upperTarget" float NOT NULL CONSTRAINT "DF_49ef8821a9bdb4fe492f6b06192" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP CONSTRAINT "DF_49ef8821a9bdb4fe492f6b06192"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP COLUMN "upperTarget"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP CONSTRAINT "DF_aa6aa524dad155482ada19767c3"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP COLUMN "lowerTarget"`);
    }
}
