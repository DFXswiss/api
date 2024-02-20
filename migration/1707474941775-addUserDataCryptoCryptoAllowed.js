const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataCryptoCryptoAllowed1707474941775 {
    name = 'addUserDataCryptoCryptoAllowed1707474941775'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "cryptoCryptoAllowed" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "cryptoCryptoAllowed"`);
    }
}
