const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class supportMessageTable1715009353122 {
    name = 'supportMessageTable1715009353122'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "support_message" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_62291e6dcf5154fcd9b23f8efa1" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_0a4d23d303372655a91777625d3" DEFAULT getdate(), "author" nvarchar(256) NOT NULL, "message" nvarchar(MAX) NOT NULL, "fileUrl" nvarchar(256), "issueId" int NOT NULL, CONSTRAINT "PK_ffc800a254f6e98e97d90fcefa8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "name" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "support_message" ADD CONSTRAINT "FK_6bdfc09227eede67ed4779f74dd" FOREIGN KEY ("issueId") REFERENCES "support_issue"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_message" DROP CONSTRAINT "FK_6bdfc09227eede67ed4779f74dd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "name"`);
        await queryRunner.query(`DROP TABLE "support_message"`);
    }
}
