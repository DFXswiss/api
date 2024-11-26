const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class KycFiles1732013545724 {
    name = 'KycFiles1732013545724'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "kyc_file" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e3c05f590e419f3df3dd19798ef" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_cafff2ca138a9b72b7841e7d590" DEFAULT getdate(), "name" nvarchar(MAX) NOT NULL, "type" nvarchar(256) NOT NULL, "protected" bit NOT NULL, "uid" nvarchar(256) NOT NULL, "userDataId" int NOT NULL, "kycStepId" int, CONSTRAINT "UQ_1882b4680f4306cc73b553ea596" UNIQUE ("uid"), CONSTRAINT "PK_192b9d25f969b397451516b313d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "kyc_file" ADD CONSTRAINT "FK_a34b22e4385a7cac26e16ab89ed" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kyc_file" ADD CONSTRAINT "FK_da534c346667b71a9b4aecb845f" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP CONSTRAINT "FK_da534c346667b71a9b4aecb845f"`);
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP CONSTRAINT "FK_a34b22e4385a7cac26e16ab89ed"`);
        await queryRunner.query(`DROP TABLE "kyc_file"`);
    }
}
