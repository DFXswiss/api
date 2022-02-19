const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedLimitRequest1644510951347 {
    name = 'AddedLimitRequest1644510951347'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "limit_request" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_f4431f920d651fcec7a0997bbc8" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_107b0d05217a7dab6b3583e8314" DEFAULT getdate(), "limit" int NOT NULL, "investmentDate" nvarchar(256) NOT NULL, "fundOrigin" nvarchar(256) NOT NULL, "fundOriginText" nvarchar(256), "documentProofUrl" nvarchar(256), "userDataId" int NOT NULL, CONSTRAINT "PK_315a4a74c85eb7348e130cf1106" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "limit_request" ADD CONSTRAINT "FK_2c2446fedd9bb64eabf0c33bc37" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "limit_request" DROP CONSTRAINT "FK_2c2446fedd9bb64eabf0c33bc37"`);
        await queryRunner.query(`DROP TABLE "limit_request"`);
    }
}
