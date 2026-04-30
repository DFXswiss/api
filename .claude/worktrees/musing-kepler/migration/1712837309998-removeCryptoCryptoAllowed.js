const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeCryptoCryptoAllowed1712837309998 {
    name = 'removeCryptoCryptoAllowed1712837309998'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "cryptoCryptoAllowed"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "cryptoCryptoAllowed" bit`);
    }
}
