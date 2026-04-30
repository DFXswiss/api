const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class MergeReason1727443350989 {
    name = 'MergeReason1727443350989'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "account_merge" ADD "reason" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "account_merge" DROP COLUMN "reason"`);
    }
}
