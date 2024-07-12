const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SupportIssueInformation1718892189636 {
    name = 'SupportIssueInformation1718892189636'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "information" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "information"`);
    }
}
