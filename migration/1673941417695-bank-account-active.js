const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankAccountActive1673941417695 {
    name = 'bankAccountActive1673941417695'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_account" ADD "active" bit NOT NULL CONSTRAINT "DF_ec679d1e8bd77302b9bfe2d29c5" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_account" DROP CONSTRAINT "DF_ec679d1e8bd77302b9bfe2d29c5"`);
        await queryRunner.query(`ALTER TABLE "bank_account" DROP COLUMN "active"`);
    }
}
