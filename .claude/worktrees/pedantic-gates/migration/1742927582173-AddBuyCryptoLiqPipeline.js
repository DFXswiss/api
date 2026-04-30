const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBuyCryptoLiqPipeline1742927582173 {
    name = 'AddBuyCryptoLiqPipeline1742927582173'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_order" ADD "inputAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_order" ADD "inputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_order" ADD "outputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "liquidityPipelineId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_81aae20f2b3ff8b78b1c777dcdf" FOREIGN KEY ("liquidityPipelineId") REFERENCES "liquidity_management_pipeline"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_81aae20f2b3ff8b78b1c777dcdf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "liquidityPipelineId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_order" DROP COLUMN "outputAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_order" DROP COLUMN "inputAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_order" DROP COLUMN "inputAmount"`);
    }
}
