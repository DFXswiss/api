const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AssetCategory1711385233909 {
    name = 'AssetCategory1711385233909'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_834006608a30d1a762fa4618647"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "DF_834006608a30d1a762fa4618647" DEFAULT 'Public' FOR "category"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP CONSTRAINT "DF_d18fcc16f8aab08733299e22017"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ADD CONSTRAINT "DF_d18fcc16f8aab08733299e22017" DEFAULT 0 FOR "amountOut"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_834006608a30d1a762fa4618647"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "DF_834006608a30d1a762fa4618647" DEFAULT 'Stock' FOR "category"`);
    }
}
