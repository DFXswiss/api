const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemovedFiatEnable1677621943796 {
    name = 'RemovedFiatEnable1677621943796'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_84e79a4c3552ef2114023fd3af6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "enable"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "enable" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD CONSTRAINT "DF_84e79a4c3552ef2114023fd3af6" DEFAULT 1 FOR "enable"`);
    }
}
