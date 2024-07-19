const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSupportIssueLimitRequestRelation1721314183039 {
    name = 'AddSupportIssueLimitRequestRelation1721314183039'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD "limitRequestId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_52618795f970d0ad40f8256652" ON "dbo"."support_issue" ("limitRequestId") WHERE "limitRequestId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" ADD CONSTRAINT "FK_52618795f970d0ad40f82566520" FOREIGN KEY ("limitRequestId") REFERENCES "limit_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP CONSTRAINT "FK_52618795f970d0ad40f82566520"`);
        await queryRunner.query(`DROP INDEX "REL_52618795f970d0ad40f8256652" ON "dbo"."support_issue"`);
        await queryRunner.query(`ALTER TABLE "dbo"."support_issue" DROP COLUMN "limitRequestId"`);
    }
}
