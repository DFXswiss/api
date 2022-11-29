const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBuyFiatRefCols1669716170239 {
    name = 'addBuyFiatRefCols1669716170239'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "usedRef" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "refProvision" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "refFactor" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "refFactor"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "refProvision"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "usedRef"`);
    }
}
