const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UsingKycTable1633387539454 {
    name = 'UsingKycTable1633387539454'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "user_data.kycFileReference", "kycFileId"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_1753b4eb3cad58e852fe06b981" ON "dbo"."user_data" ("kycFileId") WHERE "kycFileId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_1753b4eb3cad58e852fe06b9815" FOREIGN KEY ("kycFileId") REFERENCES "kyc_file"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_1753b4eb3cad58e852fe06b9815"`);
        await queryRunner.query(`DROP INDEX "REL_1753b4eb3cad58e852fe06b981" ON "dbo"."user_data"`);
        await queryRunner.query(`EXEC sp_rename "user_data.kycFileId", "kycFileReference"`);
    }
}
