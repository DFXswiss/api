const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class LiquidityManagementNotifications1729153982778 {
    name = 'LiquidityManagementNotifications1729153982778'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD "sendNotifications" bit NOT NULL CONSTRAINT "DF_786ea7f2610ca89d69765105a76" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP CONSTRAINT "DF_786ea7f2610ca89d69765105a76"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP COLUMN "sendNotifications"`);
    }
}
