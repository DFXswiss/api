const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addKycLog1700155481772 {
    name = 'addKycLog1700155481772'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "kyc_log" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_0ff263f9df59bce981ea7cc980a" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_40d6d07fea9007513a555608be5" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "result" nvarchar(MAX), "pdfUrl" nvarchar(256), "comment" nvarchar(MAX), "riskStatus" nvarchar(256), "riskEvaluation" nvarchar(256), "riskEvaluationDate" datetime2, "userDataId" int NOT NULL, "bankDataId" int NOT NULL, CONSTRAINT "PK_a60e25ccda567593cfdf655a7e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5bb43da53d5e1fed66784bdc7e" ON "kyc_log" ("type") `);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "lastNameCheckDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "kyc_log" ADD CONSTRAINT "FK_3d1856c90a8b4b20625ce8719e5" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kyc_log" ADD CONSTRAINT "FK_c6404de74ee43d27c87050939d1" FOREIGN KEY ("bankDataId") REFERENCES "bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_log" DROP CONSTRAINT "FK_c6404de74ee43d27c87050939d1"`);
        await queryRunner.query(`ALTER TABLE "kyc_log" DROP CONSTRAINT "FK_3d1856c90a8b4b20625ce8719e5"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "lastNameCheckDate"`);
        await queryRunner.query(`DROP INDEX "IDX_5bb43da53d5e1fed66784bdc7e" ON "kyc_log"`);
        await queryRunner.query(`DROP TABLE "kyc_log"`);
    }
}
