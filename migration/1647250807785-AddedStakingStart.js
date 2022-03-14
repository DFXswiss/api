const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedStakingStart1647250807785 {
    name = 'AddedStakingStart1647250807785'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "stakingStart" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "stakingStart"`);
    }
}
