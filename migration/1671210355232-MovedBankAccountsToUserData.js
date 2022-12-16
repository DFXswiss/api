const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class MovedBankAccountsToUserData1671210355232 {
    name = 'MovedBankAccountsToUserData1671210355232'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d"`);
        await queryRunner.query(`DROP INDEX "ibanUser" ON "dbo"."bank_account"`);

        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "userDataId" int`);
        await queryRunner.query(`UPDATE ba SET ba.userDataId = u.userDataId FROM dbo.bank_account ba INNER JOIN dbo.[user] u ON ba.userId = u.id`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "userId"`);
        
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account" ("iban", "userDataId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_166fa63a5cb0089c3268454f577" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_166fa63a5cb0089c3268454f577"`);
        await queryRunner.query(`DROP INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account"`);

        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "userId" int`);
        await queryRunner.query(`UPDATE ba SET ba.userId = u.id FROM dbo.bank_account ba INNER JOIN dbo.user_data ud ON ba.userDataId = ud.id INNER JOIN dbo.[user] u ON u.userDataId = ud.id`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "userDataId"`);

        await queryRunner.query(`CREATE UNIQUE INDEX "ibanUser" ON "dbo"."bank_account" ("iban", "userId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
