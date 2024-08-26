const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankDataManualCheck1723033123342 {
    name = 'bankDataManualCheck1723033123342'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "manualCheck" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "manualCheck"`);
    }
}
