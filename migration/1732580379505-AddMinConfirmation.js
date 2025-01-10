const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddMinConfirmation1732580379505 {
    name = 'AddMinConfirmation1732580379505'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "transaction_specification" ADD "minConfirmations" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "transaction_specification" DROP COLUMN "minConfirmations"`);
    }
}
