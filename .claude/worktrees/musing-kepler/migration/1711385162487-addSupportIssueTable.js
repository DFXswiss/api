const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addSupportIssueTable1711385162487 {
    name = 'addSupportIssueTable1711385162487'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "support_issue" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_c5e51a40777ddc6ad6230b65df6" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_26af55d597d76c200990055a5ea" DEFAULT getdate(), "state" nvarchar(256) NOT NULL CONSTRAINT "DF_ab5800fa72e6b8bbc95c32149eb" DEFAULT 'Created', "type" nvarchar(256) NOT NULL, "reason" nvarchar(256) NOT NULL, "description" nvarchar(MAX), "fileUrl" nvarchar(256), "transactionId" int, CONSTRAINT "PK_c1b6cd00663637abeacc1f605b4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "userId" int`);
        await queryRunner.query(`ALTER TABLE "support_issue" ADD CONSTRAINT "FK_89d3a139a375bd2dba87094fb6d" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD CONSTRAINT "FK_605baeb040ff0fae995404cea37" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP CONSTRAINT "FK_605baeb040ff0fae995404cea37"`);
        await queryRunner.query(`ALTER TABLE "support_issue" DROP CONSTRAINT "FK_89d3a139a375bd2dba87094fb6d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "userId"`);
        await queryRunner.query(`DROP TABLE "support_issue"`);
    }
}
