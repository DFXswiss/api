const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class LegalEntitySignatoryPower1722260156443 {
    name = 'LegalEntitySignatoryPower1722260156443'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "legalEntity" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "signatoryPower" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "signatoryPower"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "legalEntity"`);
    }
}
