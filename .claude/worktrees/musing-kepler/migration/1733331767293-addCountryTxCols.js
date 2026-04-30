const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addCountryTxCols1733331767293 {
    name = 'addCountryTxCols1733331767293'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "dfxOrganizationEnable" bit NOT NULL CONSTRAINT "DF_4a05867ba291b6aa7d715d52f5a" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "bankEnable" bit NOT NULL CONSTRAINT "DF_c3dddbfc5c344e2135061302519" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "cryptoEnable" bit NOT NULL CONSTRAINT "DF_d9cd07432f1da0a9bd0c57f149d" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_d9cd07432f1da0a9bd0c57f149d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "cryptoEnable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_c3dddbfc5c344e2135061302519"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "bankEnable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_4a05867ba291b6aa7d715d52f5a"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "dfxOrganizationEnable"`);
    }
}
