const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class KycLogFile1738319166726 {
    name = 'KycLogFile1738319166726'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_log" ADD "fileId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_73df258b5010de85f1869d2991" ON "kyc_log" ("fileId") WHERE "fileId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "kyc_log" ADD CONSTRAINT "FK_73df258b5010de85f1869d2991f" FOREIGN KEY ("fileId") REFERENCES "kyc_file"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_log" DROP CONSTRAINT "FK_73df258b5010de85f1869d2991f"`);
        await queryRunner.query(`DROP INDEX "REL_73df258b5010de85f1869d2991" ON "kyc_log"`);
        await queryRunner.query(`ALTER TABLE "kyc_log" DROP COLUMN "fileId"`);
    }
}
