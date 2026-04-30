const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeBuyFiatOutputAssetStringCol1709043105474 {
    name = 'removeBuyFiatOutputAssetStringCol1709043105474'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputReferenceAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputAsset"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputReferenceAsset" nvarchar(256)`);
    }
}
