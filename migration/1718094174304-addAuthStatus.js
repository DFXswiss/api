const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addAuthStatus1718094174304 {
    name = 'addAuthStatus1718094174304'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ADD "authStatusReason" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" DROP COLUMN "authStatusReason"`);
    }
}
