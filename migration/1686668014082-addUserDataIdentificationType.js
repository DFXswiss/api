const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataIdentificationType1686668014082 {
    name = 'addUserDataIdentificationType1686668014082'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "identificationType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "identificationType"`);
    }
}
