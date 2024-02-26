const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addAssetInstantCardCol1708528000647 {
    name = 'addAssetInstantCardCol1708528000647'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "cardBuyable" bit NOT NULL CONSTRAINT "DF_c68107c2901e8edd5aba8e5a611" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "cardSellable" bit NOT NULL CONSTRAINT "DF_c86c510c1b6f1d2cf71872809a4" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "instantBuyable" bit NOT NULL CONSTRAINT "DF_5273bb48d7a7fa33ac441f04cc2" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "instantSellable" bit NOT NULL CONSTRAINT "DF_21fc7a23ef9aa465cd032588f99" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_21fc7a23ef9aa465cd032588f99"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "instantSellable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_5273bb48d7a7fa33ac441f04cc2"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "instantBuyable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_c86c510c1b6f1d2cf71872809a4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "cardSellable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_c68107c2901e8edd5aba8e5a611"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "cardBuyable"`);
    }
}
