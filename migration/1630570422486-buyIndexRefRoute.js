const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyIndexRefRoute1630570422486 {
    name = 'buyIndexRefRoute1630570422486'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanAsset" ON "dbo"."buy"`);
        await queryRunner.query(`CREATE TABLE "ref" ("id" int NOT NULL IDENTITY(1,1), "ref" varchar(256) NOT NULL, "ip" varchar(256) NOT NULL, "updated" datetime2 NOT NULL CONSTRAINT "DF_91b5b877cb854489af9c6953bb1" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_aaf9c56940a709f8d39e5f616b1" DEFAULT getdate(), CONSTRAINT "UQ_ca2ec1ac9b89120336cdcb4cdcb" UNIQUE ("ip"), CONSTRAINT "PK_1869dabd26c52d6364ef6e3b1eb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAddressAsset" ON "dbo"."buy" ("iban", "assetId", "address") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanAddressAsset" ON "dbo"."buy"`);
        await queryRunner.query(`DROP TABLE "ref"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAsset" ON "dbo"."buy" ("iban", "assetId") `);
    }
}
