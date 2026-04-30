const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SupportIssueUId1726241282692 {
    name = 'SupportIssueUId1726241282692'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" ADD "uid" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" DROP COLUMN "uid"`);
    }
}
