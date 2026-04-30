const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSenderAddresses1730705112313 {
    name = 'AddSenderAddresses1730705112313'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "senderAddresses" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "senderAddresses"`);
    }
}
