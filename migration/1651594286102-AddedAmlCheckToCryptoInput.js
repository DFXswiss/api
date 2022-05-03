const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedAmlCheckToCryptoInput1651594286102 {
    name = 'AddedAmlCheckToCryptoInput1651594286102'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "amlCheck" nvarchar(256) NOT NULL CONSTRAINT "DF_82bf6f09ca6607ebfe0c1aeb100" DEFAULT 'Fail'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_82bf6f09ca6607ebfe0c1aeb100"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "amlCheck"`);
    }
}
