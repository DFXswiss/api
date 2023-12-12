const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class FiatCardSpec1702368838915 {
    name = 'FiatCardSpec1702368838915'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE"dbo"."fiat" ADD "cardBuyable" bit NOT NULL CONSTRAINT "DF_9d9422959d23a1a44c8273e3ef9" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE"dbo"."fiat" ADD "cardSellable" bit NOT NULL CONSTRAINT "DF_7ca9a049949749841ccff3762e8" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE"dbo"."fiat" DROP CONSTRAINT "DF_7ca9a049949749841ccff3762e8"`);
        await queryRunner.query(`ALTER TABLE"dbo"."fiat" DROP COLUMN "cardSellable"`);
        await queryRunner.query(`ALTER TABLE"dbo"."fiat" DROP CONSTRAINT "DF_9d9422959d23a1a44c8273e3ef9"`);
        await queryRunner.query(`ALTER TABLE"dbo"."fiat" DROP COLUMN "cardBuyable"`);
    }
}
