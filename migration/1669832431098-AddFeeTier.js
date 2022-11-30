const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddFeeTier1669832431098 {
    name = 'AddFeeTier1669832431098'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ADD "feeTier" nvarchar(256) NOT NULL CONSTRAINT "DF_8d629c2b9f20a857316a1ccf19b" DEFAULT 'Tier2'`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_adfdecaaa23bb17b89c4ad01e71"`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "DF_adfdecaaa23bb17b89c4ad01e71" DEFAULT 0.25 FOR "refFeePercent"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_adfdecaaa23bb17b89c4ad01e71"`);
        await queryRunner.query(`ALTER TABLE "user" ADD CONSTRAINT "DF_adfdecaaa23bb17b89c4ad01e71" DEFAULT 0.5 FOR "refFeePercent"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_8d629c2b9f20a857316a1ccf19b"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "feeTier"`);
    }
}
