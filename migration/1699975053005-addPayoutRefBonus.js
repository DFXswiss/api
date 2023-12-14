const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addPayoutRefBonus1699975053005 {
    name = 'addPayoutRefBonus1699975053005'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "payoutRefBonus" bit NOT NULL CONSTRAINT "DF_42980b99e804108bcb7d7adb817" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "DF_42980b99e804108bcb7d7adb817"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "payoutRefBonus"`);
    }
}
