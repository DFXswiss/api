const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AmlComment1710429164723 {
    name = 'AmlComment1710429164723'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "comment" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "comment" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "comment"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "comment"`);
    }
}
