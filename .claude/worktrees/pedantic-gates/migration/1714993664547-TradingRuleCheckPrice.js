const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TradingRuleCheckPrice1714993664547 {
    name = 'TradingRuleCheckPrice1714993664547'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" ADD "source3" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" ADD "leftAsset3" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" ADD "rightAsset3" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP COLUMN "rightAsset3"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP COLUMN "leftAsset3"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_rule" DROP COLUMN "source3"`);
    }
}
