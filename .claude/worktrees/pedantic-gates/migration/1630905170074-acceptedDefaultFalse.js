const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class acceptedDefaultFalse1630905170074 {
    name = 'acceptedDefaultFalse1630905170074'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "DF_0bd8626d46bf61535e6504731a3"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD CONSTRAINT "DF_0bd8626d46bf61535e6504731a3" DEFAULT 0 FOR "accepted"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "DF_d867d2f9f3f44cd2eb616a4cc72"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD CONSTRAINT "DF_d867d2f9f3f44cd2eb616a4cc72" DEFAULT 0 FOR "accepted"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "DF_d4f84919c752e2c7acab7cafce2"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "DF_d4f84919c752e2c7acab7cafce2" DEFAULT 0 FOR "accepted"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "DF_d4f84919c752e2c7acab7cafce2"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "DF_d4f84919c752e2c7acab7cafce2" DEFAULT 1 FOR "accepted"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP CONSTRAINT "DF_d867d2f9f3f44cd2eb616a4cc72"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD CONSTRAINT "DF_d867d2f9f3f44cd2eb616a4cc72" DEFAULT 1 FOR "accepted"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP CONSTRAINT "DF_0bd8626d46bf61535e6504731a3"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD CONSTRAINT "DF_0bd8626d46bf61535e6504731a3" DEFAULT 1 FOR "accepted"`);
    }
}
