/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RenameRewardOutputAssetEntity1762339903671 {
    name = 'RenameRewardOutputAssetEntity1762339903671'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP CONSTRAINT "FK_75cea215e148f5bf53025752f8c"`);
        await queryRunner.query(`ALTER TABLE "staking_reward" DROP CONSTRAINT "FK_f3c0904de3778fefcd6c91500b1"`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" DROP CONSTRAINT "FK_60662310f598aa19ea2f2ced515"`);
        await queryRunner.query(`EXEC sp_rename ref_reward.outputAssetEntityId", "outputAssetId"`);
        await queryRunner.query(`EXEC sp_rename staking_reward.outputAssetEntityId", "outputAssetId"`);
        await queryRunner.query(`EXEC sp_rename staking_ref_reward.outputAssetEntityId", "outputAssetId"`);
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD CONSTRAINT "FK_8706ada4924baf0b267b0501c8b" FOREIGN KEY ("outputAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "staking_reward" ADD CONSTRAINT "FK_c96a97b5909a60639145b724cda" FOREIGN KEY ("outputAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" ADD CONSTRAINT "FK_6ac4ef2ce62d9892fff37f6462b" FOREIGN KEY ("outputAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" DROP CONSTRAINT "FK_6ac4ef2ce62d9892fff37f6462b"`);
        await queryRunner.query(`ALTER TABLE "staking_reward" DROP CONSTRAINT "FK_c96a97b5909a60639145b724cda"`);
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP CONSTRAINT "FK_8706ada4924baf0b267b0501c8b"`);
        await queryRunner.query(`EXEC sp_rename staking_ref_reward.outputAssetId", "outputAssetEntityId"`);
        await queryRunner.query(`EXEC sp_rename staking_reward.outputAssetId", "outputAssetEntityId"`);
        await queryRunner.query(`EXEC sp_rename ref_reward.outputAssetId", "outputAssetEntityId"`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" ADD CONSTRAINT "FK_60662310f598aa19ea2f2ced515" FOREIGN KEY ("outputAssetEntityId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "staking_reward" ADD CONSTRAINT "FK_f3c0904de3778fefcd6c91500b1" FOREIGN KEY ("outputAssetEntityId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD CONSTRAINT "FK_75cea215e148f5bf53025752f8c" FOREIGN KEY ("outputAssetEntityId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
