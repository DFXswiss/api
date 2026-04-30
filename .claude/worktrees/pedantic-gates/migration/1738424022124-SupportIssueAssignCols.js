const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SupportIssueAssignCols1738424022124 {
    name = 'SupportIssueAssignCols1738424022124'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "support_log" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_9f9a673abdddb52f8a9e9a8f18e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_7bf9fdecee0fd4ad86a53e3b93e" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "message" nvarchar(MAX), "comment" nvarchar(MAX), "clerk" nvarchar(256), "eventDate" datetime2, "decision" nvarchar(256), "state" nvarchar(256), "department" nvarchar(256), "userDataId" int NOT NULL, "limitRequestId" int, "supportIssueId" int, CONSTRAINT "PK_85953ba2699758c0e939de3be90" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5b6bd285c0baf1deab42fdbaef" ON "support_log" ("type") `);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "clerk" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "department" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "support_log" ADD CONSTRAINT "FK_2b3b0fae479b9c6a7b273c06db4" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "support_log" ADD CONSTRAINT "FK_2f91b0cacd4211fe1bbe72f1c05" FOREIGN KEY ("limitRequestId") REFERENCES "limit_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "support_log" ADD CONSTRAINT "FK_aa91047753c3fc6b97940ac0d1c" FOREIGN KEY ("supportIssueId") REFERENCES "support_issue"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_log" DROP CONSTRAINT "FK_aa91047753c3fc6b97940ac0d1c"`);
        await queryRunner.query(`ALTER TABLE "support_log" DROP CONSTRAINT "FK_2f91b0cacd4211fe1bbe72f1c05"`);
        await queryRunner.query(`ALTER TABLE "support_log" DROP CONSTRAINT "FK_2b3b0fae479b9c6a7b273c06db4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "department"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "clerk"`);
        await queryRunner.query(`DROP INDEX "IDX_5b6bd285c0baf1deab42fdbaef" ON "support_log"`);
        await queryRunner.query(`DROP TABLE "support_log"`);
    }
}
