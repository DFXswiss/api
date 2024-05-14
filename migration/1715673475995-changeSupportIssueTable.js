const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class changeSupportIssueTable1715673475995 {
    name = 'changeSupportIssueTable1715673475995'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "description"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "fileUrl"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ALTER COLUMN "name" nvarchar(256) NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ALTER COLUMN "name" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "fileUrl" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "description" nvarchar(MAX)`);
    }
}
