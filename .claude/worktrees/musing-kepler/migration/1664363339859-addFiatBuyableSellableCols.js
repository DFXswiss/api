const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFiatBuyableSellableCols1664363339859 {
    name = 'addFiatBuyableSellableCols1664363339859'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "buyable" bit NOT NULL CONSTRAINT "DF_8e87e46c42a0570b4845ff73ab0" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "sellable" bit NOT NULL CONSTRAINT "DF_41b20c12dda3b0838b3cc53a67c" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_41b20c12dda3b0838b3cc53a67c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "sellable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_8e87e46c42a0570b4845ff73ab0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "buyable"`);
    }
}
