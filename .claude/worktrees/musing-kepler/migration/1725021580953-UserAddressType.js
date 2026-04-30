const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UserAddressType1725021580953 {
    name = 'UserAddressType1725021580953'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "addressType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "addressType"`);
    }
}
