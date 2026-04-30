const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddKycLogSynced1744382196177 {
    name = 'AddKycLogSynced1744382196177'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "REL_73df258b5010de85f1869d2991" ON "dbo"."kyc_log"`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD "synced" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP COLUMN "synced"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_73df258b5010de85f1869d2991" ON "dbo"."kyc_log" ("fileId") WHERE ([fileId] IS NOT NULL)`);
    }
}
