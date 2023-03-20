const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeStakingCols1678570625764 {
    name = 'removeStakingCols1678570625764'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "stakingFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "stakingStart"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_eed6aa936c30d687da507471e7a"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "paidStakingRefCredit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_8a0099ab4d2a1d37e5da12ab4cc"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "stakingBalance"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_99edc23c9dede314ed8d03815df"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "stakingBalance"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "stakingBalance" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_99edc23c9dede314ed8d03815df" DEFAULT 0 FOR "stakingBalance"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "stakingBalance" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_8a0099ab4d2a1d37e5da12ab4cc" DEFAULT 0 FOR "stakingBalance"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "paidStakingRefCredit" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "DF_eed6aa936c30d687da507471e7a" DEFAULT 0 FOR "paidStakingRefCredit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "stakingStart" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "stakingFee" float`);
    }
}
