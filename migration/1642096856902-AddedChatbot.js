const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedChatbot1642096856902 {
    name = 'AddedChatbot1642096856902'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_1753b4eb3cad58e852fe06b9815"`);
        await queryRunner.query(`DROP INDEX "REL_1753b4eb3cad58e852fe06b981" ON "dbo"."user_data"`);
        await queryRunner.query(`CREATE TABLE "chatbot" ("id" int NOT NULL IDENTITY(1,1), "url" nvarchar(256) NOT NULL, "version" nvarchar(256) NOT NULL, "result" nvarchar(255), "userDataId" int NOT NULL, CONSTRAINT "PK_1ee1961e62c5cec278314f1d68e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_1d94d48a365f1a8c92b1e8ef6c" ON "chatbot" ("userDataId") WHERE "userDataId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "riskState" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionAmount" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionCurrency" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "plannedContribution" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "chatbot" ADD CONSTRAINT "FK_1d94d48a365f1a8c92b1e8ef6cf" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "chatbot" DROP CONSTRAINT "FK_1d94d48a365f1a8c92b1e8ef6cf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "plannedContribution"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionCurrency"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "riskState"`);
        await queryRunner.query(`DROP INDEX "REL_1d94d48a365f1a8c92b1e8ef6c" ON "chatbot"`);
        await queryRunner.query(`DROP TABLE "chatbot"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_1753b4eb3cad58e852fe06b981" ON "dbo"."user_data" ("kycFileId") WHERE ([kycFileId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_1753b4eb3cad58e852fe06b9815" FOREIGN KEY ("kycFileId") REFERENCES "kyc_file"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
