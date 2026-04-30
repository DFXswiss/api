const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RenamedIsPayback1648559523365 {
    name = 'RenamedIsPayback1648559523365'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "crypto_input.isPayback", "isReturned"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_49982d860173c06877a2eeb69eb"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "DF_b4e6db6a5e7c13d9729e19ead3d" DEFAULT 0 FOR "isReturned"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_b4e6db6a5e7c13d9729e19ead3d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "DF_49982d860173c06877a2eeb69eb" DEFAULT 0 FOR "isReturned"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.isReturned", "isPayback"`);
    }
}
