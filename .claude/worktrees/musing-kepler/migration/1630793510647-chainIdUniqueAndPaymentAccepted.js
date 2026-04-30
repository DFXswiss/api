const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class chainIdUniqueAndPaymentAccepted1630793510647 {
    name = 'chainIdUniqueAndPaymentAccepted1630793510647'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD "accepted" bit NOT NULL CONSTRAINT "DF_0bd8626d46bf61535e6504731a3" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD "accepted" bit NOT NULL CONSTRAINT "DF_d867d2f9f3f44cd2eb616a4cc72" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD "accepted" bit NOT NULL CONSTRAINT "DF_d4f84919c752e2c7acab7cafce2" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "chainId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "UQ_73cbdeb6eea93ce3d67eeaed655" UNIQUE ("chainId")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "UQ_73cbdeb6eea93ce3d67eeaed655"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "chainId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "DF_d4f84919c752e2c7acab7cafce2"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP COLUMN "accepted"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "DF_d867d2f9f3f44cd2eb616a4cc72"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP COLUMN "accepted"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "DF_0bd8626d46bf61535e6504731a3"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP COLUMN "accepted"`);
    }
}
