const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedKycTable1633031752353 {
    name = 'AddedKycTable1633031752353'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "kyc_file" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e3c05f590e419f3df3dd19798ef" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_cafff2ca138a9b72b7841e7d590" DEFAULT getdate(), "userDataId" int, CONSTRAINT "PK_192b9d25f969b397451516b313d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_a34b22e4385a7cac26e16ab89e" ON "kyc_file" ("userDataId") WHERE "userDataId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycRequestDate"`);
        await queryRunner.query(`ALTER TABLE "kyc_file" ADD CONSTRAINT "FK_a34b22e4385a7cac26e16ab89ed" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP CONSTRAINT "FK_a34b22e4385a7cac26e16ab89ed"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycRequestDate" datetime2`);
        await queryRunner.query(`DROP INDEX "REL_a34b22e4385a7cac26e16ab89e" ON "kyc_file"`);
        await queryRunner.query(`DROP TABLE "kyc_file"`);
    }
}
