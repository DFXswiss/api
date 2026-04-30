const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class LmOrderOutputAmount1742992597290 {
    name = 'LmOrderOutputAmount1742992597290'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "outputAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "outputAmount"`);
    }
}
