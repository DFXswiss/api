const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataInternalAmlNote1686836193039 {
    name = 'addUserDataInternalAmlNote1686836193039'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "internalAmlNote" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "internalAmlNote"`);
    }
}
