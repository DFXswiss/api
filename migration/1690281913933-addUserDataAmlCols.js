const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataAmlCols1690281913933 {
    name = 'addUserDataAmlCols1690281913933'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "pep" bit`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "bankTransactionVerification" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "bankTransactionVerification"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "pep"`);
    }
}
