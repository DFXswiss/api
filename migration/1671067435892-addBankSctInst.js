const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankSctInst1671067435892 {
    name = 'addBankSctInst1671067435892'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank" ADD "sctInst" bit NOT NULL CONSTRAINT "DF_4a2bcad5d01e25259e297a79f83" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank" DROP CONSTRAINT "DF_4a2bcad5d01e25259e297a79f83"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank" DROP COLUMN "sctInst"`);
    }
}
