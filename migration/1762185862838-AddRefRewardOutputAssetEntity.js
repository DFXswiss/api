/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRefRewardOutputAssetEntity1762185862838 {
    name = 'AddRefRewardOutputAssetEntity1762185862838'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "ref_reward.outputAsset", "outputAssetString"`);
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD "outputAssetEntityId" int`);
        await queryRunner.query(`EXEC sp_rename "staking_reward.outputAsset", "outputAssetString"`);
        await queryRunner.query(`ALTER TABLE "staking_reward" ADD "outputAssetEntityId" int`);
        await queryRunner.query(`EXEC sp_rename "staking_ref_reward.outputAsset", "outputAssetString"`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" ADD "outputAssetEntityId" int`);
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD CONSTRAINT "FK_75cea215e148f5bf53025752f8c" FOREIGN KEY ("outputAssetEntityId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "staking_reward" ADD CONSTRAINT "FK_f3c0904de3778fefcd6c91500b1" FOREIGN KEY ("outputAssetEntityId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" ADD CONSTRAINT "FK_60662310f598aa19ea2f2ced515" FOREIGN KEY ("outputAssetEntityId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" DROP CONSTRAINT "FK_60662310f598aa19ea2f2ced515"`);
        await queryRunner.query(`ALTER TABLE "staking_reward" DROP CONSTRAINT "FK_f3c0904de3778fefcd6c91500b1"`);
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP CONSTRAINT "FK_75cea215e148f5bf53025752f8c"`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" DROP COLUMN "outputAssetEntityId"`);
        await queryRunner.query(`EXEC sp_rename "staking_ref_reward.outputAssetString", "outputAsset"`);
        await queryRunner.query(`ALTER TABLE "staking_reward" DROP COLUMN "outputAssetEntityId"`);
        await queryRunner.query(`EXEC sp_rename "staking_reward.outputAssetString", "outputAsset"`);
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP COLUMN "outputAssetEntityId"`);
        await queryRunner.query(`EXEC sp_rename "ref_reward.outputAssetString", "outputAsset"`);
    }
}
