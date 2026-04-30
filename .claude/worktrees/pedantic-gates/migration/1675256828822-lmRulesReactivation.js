const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class lmRulesReactivation1675256828822 {
    name = 'lmRulesReactivation1675256828822'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD "reactivationTime" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP COLUMN "reactivationTime"`);
    }
}
