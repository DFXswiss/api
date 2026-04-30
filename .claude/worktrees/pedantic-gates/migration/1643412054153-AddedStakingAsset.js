const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedStakingAsset1643412054153 {
    name = 'AddedStakingAsset1643412054153'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "rewardAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "paybackAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD CONSTRAINT "FK_4dcaef82d41e2edac13836cd60d" FOREIGN KEY ("rewardAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD CONSTRAINT "FK_18d8b5edf0bc3420be7cc8190e6" FOREIGN KEY ("paybackAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "FK_18d8b5edf0bc3420be7cc8190e6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "FK_4dcaef82d41e2edac13836cd60d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "paybackAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "rewardAssetId"`);
    }
}
