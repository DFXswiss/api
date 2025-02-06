const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class FiatOutputReport1738681331278 {
    name = 'FiatOutputReport1738681331278'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "reportCreated" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "reportCreated"`);
    }
}
