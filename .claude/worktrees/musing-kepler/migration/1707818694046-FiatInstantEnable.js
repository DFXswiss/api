const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class FiatInstantEnable1707818694046 {
    name = 'FiatInstantEnable1707818694046'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "instantBuyable" bit NOT NULL CONSTRAINT "DF_3475b4434640e2b684076d56774" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "instantSellable" bit NOT NULL CONSTRAINT "DF_b34e1ca871cbe1837769313272d" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_b34e1ca871cbe1837769313272d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "instantSellable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_3475b4434640e2b684076d56774"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "instantBuyable"`);
    }
}
