module.exports = class AdaptiveLiquidityManagement1747757193317 {
    name = 'AdaptiveLiquidityManagement1747757193317'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "liquidity_management_order.amount", "minAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "maxAmount" float`);

        await queryRunner.query(`EXEC sp_rename "liquidity_management_pipeline.targetAmount", "minAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD "maxAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP COLUMN "maxAmount"`);
        await queryRunner.query(`EXEC sp_rename "liquidity_management_pipeline.minAmount", "targetAmount"`);

        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "maxAmount"`);
        await queryRunner.query(`EXEC sp_rename "liquidity_management_order.minAmount", "amount"`);
    }
}
