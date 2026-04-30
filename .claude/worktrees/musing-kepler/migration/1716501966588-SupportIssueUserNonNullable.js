const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SupportIssueUserNonNullable1716501966588 {
    name = 'SupportIssueUserNonNullable1716501966588'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP CONSTRAINT "FK_740b0ab59ed9cf0d5700f266048"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ALTER COLUMN "userDataId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD CONSTRAINT "FK_740b0ab59ed9cf0d5700f266048" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP CONSTRAINT "FK_740b0ab59ed9cf0d5700f266048"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ALTER COLUMN "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD CONSTRAINT "FK_740b0ab59ed9cf0d5700f266048" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
