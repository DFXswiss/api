const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddWalletExceptAmlRules1754924055973 {
    name = 'AddWalletExceptAmlRules1754924055973'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "exceptAmlRules" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "exceptAmlRules"`);
    }
}
