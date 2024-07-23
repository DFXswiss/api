const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddressLabel1721730420883 {
    name = 'AddressLabel1721730420883'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" ADD "displayName" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "user" ADD "label" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "label"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "displayName"`);
    }
}
