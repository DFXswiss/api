const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TravelRulePdf1740490560669 {
    name = 'TravelRulePdf1740490560669'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "travelRulePdfDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "travelRulePdfDate"`);
    }
}
