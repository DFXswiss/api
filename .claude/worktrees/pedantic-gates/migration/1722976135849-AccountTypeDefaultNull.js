const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AccountTypeDefaultNull1722976135849 {
    name = 'AccountTypeDefaultNull1722976135849'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_6e5a2daed16c3dd01f72a064cf" ON "dbo"."user_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "accountType" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_ce7df347a5849ff214864a8621b"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6e5a2daed16c3dd01f72a064cf" ON "dbo"."user_data" ("identDocumentId", "nationalityId", "accountType", "kycType") WHERE identDocumentId IS NOT NULL AND accountType IS NOT NULL AND kycType IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_6e5a2daed16c3dd01f72a064cf" ON "dbo"."user_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_ce7df347a5849ff214864a8621b" DEFAULT 'Personal' FOR "accountType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "accountType" nvarchar(256) NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6e5a2daed16c3dd01f72a064cf" ON "dbo"."user_data" ("identDocumentId", "nationalityId", "accountType", "kycType") WHERE ([identDocumentId] IS NOT NULL AND [accountType] IS NOT NULL AND [kycType] IS NOT NULL)`);
    }
}
