const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addKycStep1699993792847 {
    name = 'addKycStep1699993792847'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "kyc_step" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_8c9edf8d24eeee815ead6e9de30" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_b69ad6cda60bffe5421182267eb" DEFAULT getdate(), "name" nvarchar(255) NOT NULL, "status" nvarchar(255) NOT NULL, "sessionId" nvarchar(255), "userDataId" int NOT NULL, CONSTRAINT "PK_fcd6a4863a74f43a3cad2ce5b92" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "kyc_step" ADD CONSTRAINT "FK_04c352bfacb76b730b9e21c5e8e" FOREIGN KEY ("userDataId") REFERENCES "sqldb-dfx-api-dev".."user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_step" DROP CONSTRAINT "FK_04c352bfacb76b730b9e21c5e8e"`);
        await queryRunner.query(`DROP TABLE "kyc_step"`);
    }
}
