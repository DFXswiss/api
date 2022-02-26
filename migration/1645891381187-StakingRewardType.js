const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class StakingRewardType1645891381187 {
    name = 'StakingRewardType1645891381187'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ADD "stakingRewardType" nvarchar(256) NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" DROP COLUMN "stakingRewardType"`);
    }
}
