const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserApproved1702560534941 {
    name = 'addUserApproved1702560534941'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "approved" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "approved"`);
    }
}
