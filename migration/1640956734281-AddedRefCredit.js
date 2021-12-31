const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedRefCredit1640956734281 {
    name = 'AddedRefCredit1640956734281'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "refCredit" float NOT NULL CONSTRAINT "DF_0e493ca8f4e3bc9eb3507a36863" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "refProvision" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "refProvision"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_0e493ca8f4e3bc9eb3507a36863"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "refCredit"`);
    }
}
