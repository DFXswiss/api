const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RefFee1634567460981 {
    name = 'RefFee1634567460981'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "refFeePercent" float NOT NULL CONSTRAINT "DF_adfdecaaa23bb17b89c4ad01e71" DEFAULT 0.5`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "refFeeAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_b17cea654b3115f102f42e4576c" FOREIGN KEY ("refFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_b17cea654b3115f102f42e4576c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "refFeeAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_adfdecaaa23bb17b89c4ad01e71"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "refFeePercent"`);
    }
}
