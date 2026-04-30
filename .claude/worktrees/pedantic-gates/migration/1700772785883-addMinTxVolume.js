const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addMinTxVolume1700772785883 {
    name = 'addMinTxVolume1700772785883'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "minTxVolume" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "minTxVolume"`);
    }
}
