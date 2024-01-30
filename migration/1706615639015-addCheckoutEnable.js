const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addCheckoutEnable1706615639015 {
    name = 'addCheckoutEnable1706615639015'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "checkoutEnable" bit NOT NULL CONSTRAINT "DF_b728eb379d4b1d7ec179edd4874" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_b728eb379d4b1d7ec179edd4874"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "checkoutEnable"`);
    }
}
