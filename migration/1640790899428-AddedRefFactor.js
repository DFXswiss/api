const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedRefFactor1640790899428 {
    name = 'AddedRefFactor1640790899428'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "refFactor" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_008a555620164eed6e1107d9814"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_008a555620164eed6e1107d9814" DEFAULT 90000 FOR "depositLimit"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_008a555620164eed6e1107d9814"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_008a555620164eed6e1107d9814" DEFAULT 45000 FOR "depositLimit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "refFactor"`);
    }
}
