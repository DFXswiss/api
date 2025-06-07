const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAssetBank1748454754162 {
    name = 'AddAssetBank1748454754162'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank" ADD "assetId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_b4598d849b1bebd04213e13700" ON "dbo"."bank" ("assetId") WHERE "assetId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank" ADD CONSTRAINT "FK_b4598d849b1bebd04213e137001" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank" DROP CONSTRAINT "FK_b4598d849b1bebd04213e137001"`);
        await queryRunner.query(`DROP INDEX "REL_b4598d849b1bebd04213e13700" ON "dbo"."bank"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank" DROP COLUMN "assetId"`);
    }
}
