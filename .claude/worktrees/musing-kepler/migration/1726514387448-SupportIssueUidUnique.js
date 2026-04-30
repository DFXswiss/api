const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SupportIssueUidUnique1726514387448 {
    name = 'SupportIssueUidUnique1726514387448'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" ALTER COLUMN "uid" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "support_issue" ADD CONSTRAINT "UQ_f54a892b25113b4cb41d129adc2" UNIQUE ("uid")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_issue" DROP CONSTRAINT "UQ_f54a892b25113b4cb41d129adc2"`);
        await queryRunner.query(`ALTER TABLE "support_issue" ALTER COLUMN "uid" nvarchar(256)`);
    }
}
