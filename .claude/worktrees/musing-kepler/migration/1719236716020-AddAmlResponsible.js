const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAmlResponsible1719236716020 {
    name = 'AddAmlResponsible1719236716020'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "amlResponsible" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "amlResponsible" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "amlResponsible"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "amlResponsible"`);
    }
}
