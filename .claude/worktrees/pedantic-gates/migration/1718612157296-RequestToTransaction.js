const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RequestToTransaction1718612157296 {
    name = 'RequestToTransaction1718612157296'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "externalId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "requestId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_27a25589b58577c10efca4f0d1" ON "dbo"."transaction" ("requestId") WHERE "requestId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD CONSTRAINT "FK_27a25589b58577c10efca4f0d15" FOREIGN KEY ("requestId") REFERENCES "transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP CONSTRAINT "FK_27a25589b58577c10efca4f0d15"`);
        await queryRunner.query(`DROP INDEX "REL_27a25589b58577c10efca4f0d1" ON "dbo"."transaction"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "requestId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "externalId"`);
    }
}
