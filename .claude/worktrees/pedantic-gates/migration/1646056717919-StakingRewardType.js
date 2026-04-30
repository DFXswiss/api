const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class StakingRewardType1646056717919 {
    name = 'StakingRewardType1646056717919'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ADD "payoutType" nvarchar(256) NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" DROP COLUMN "payoutType"`);
    }
}
