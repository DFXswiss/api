const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveUserDataRiskState1740864893515 {
    name = 'RemoveUserDataRiskState1740864893515'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "riskState"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "riskState" nvarchar(256)`);
    }
}
