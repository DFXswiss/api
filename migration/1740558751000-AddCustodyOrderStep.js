const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCustodyOrderStep1740558751000 {
    name = 'AddCustodyOrderStep1740558751000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "custody_order" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_05a11c8d2e14e0bf7481ced4e60" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_a0f30fe38b7521e56e51a0cdf89" DEFAULT getdate(), "type" nvarchar(255) NOT NULL, "status" nvarchar(255) NOT NULL CONSTRAINT "DF_7038d6342d918b933c2aaf19398" DEFAULT 'Created', "userId" int NOT NULL, "transactionRequestId" int NOT NULL, CONSTRAINT "PK_efa3e35a5e78f87012d49cee680" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_553f9007365042c17f4f3925fc" ON "custody_order" ("transactionRequestId") WHERE "transactionRequestId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyAddressIndex" int`);
        await queryRunner.query(`ALTER TABLE "user" ADD "custodyAddressType" nvarchar(255)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6a93cd1ec23d0a32f74cd6a0da" ON "user" ("custodyAddressIndex") WHERE custodyAddressIndex IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "custody_order" ADD CONSTRAINT "FK_283fccd10388b100d199f3c798a" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "custody_order" ADD CONSTRAINT "FK_553f9007365042c17f4f3925fc6" FOREIGN KEY ("transactionRequestId") REFERENCES "transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "custody_order" DROP CONSTRAINT "FK_553f9007365042c17f4f3925fc6"`);
        await queryRunner.query(`ALTER TABLE "custody_order" DROP CONSTRAINT "FK_283fccd10388b100d199f3c798a"`);
        await queryRunner.query(`DROP INDEX "IDX_6a93cd1ec23d0a32f74cd6a0da" ON "user"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyAddressType"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "custodyAddressIndex"`);
        await queryRunner.query(`DROP INDEX "REL_553f9007365042c17f4f3925fc" ON "custody_order"`);
        await queryRunner.query(`DROP TABLE "custody_order"`);
    }
}
