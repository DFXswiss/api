const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddressLabel1721730420883 {
    name = 'AddressLabel1721730420883'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "displayName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "label" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "label"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "displayName"`);
    }
}
