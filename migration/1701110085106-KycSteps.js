const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class KycSteps1701110085106 {
    name = 'KycSteps1701110085106'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "kyc_step" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_8c9edf8d24eeee815ead6e9de30" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_b69ad6cda60bffe5421182267eb" DEFAULT getdate(), "name" nvarchar(255) NOT NULL, "type" nvarchar(255), "status" nvarchar(255) NOT NULL, "sequenceNumber" int NOT NULL, "sessionId" nvarchar(255), "transactionId" nvarchar(255), "result" nvarchar(MAX), "userDataId" int NOT NULL, CONSTRAINT "PK_fcd6a4863a74f43a3cad2ce5b92" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3a1150791476264753a67212a1" ON "kyc_step" ("userDataId", "name", "type", "sequenceNumber") `);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycLevel" int NOT NULL CONSTRAINT "DF_1e58eee6494992f55e67fb6ae12" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_2e6642ec09da8e0da57dfed3389"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "languageId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "kyc_step" ADD CONSTRAINT "FK_04c352bfacb76b730b9e21c5e8e" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_2e6642ec09da8e0da57dfed3389" FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_2e6642ec09da8e0da57dfed3389"`);
        await queryRunner.query(`ALTER TABLE "kyc_step" DROP CONSTRAINT "FK_04c352bfacb76b730b9e21c5e8e"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ALTER COLUMN "languageId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_2e6642ec09da8e0da57dfed3389" FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_1e58eee6494992f55e67fb6ae12"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycLevel"`);
        await queryRunner.query(`DROP INDEX "IDX_3a1150791476264753a67212a1" ON "kyc_step"`);
        await queryRunner.query(`DROP TABLE "kyc_step"`);
    }
}
