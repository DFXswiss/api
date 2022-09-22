const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addWalletCols1663859336813 {
    name = 'addWalletCols1663859336813'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "isKycClient" bit NOT NULL CONSTRAINT "DF_d51aa6358a55a6580489a05a4f1" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "apiUrl" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "apiUrl"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_d51aa6358a55a6580489a05a4f1"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "isKycClient"`);
    }
}
