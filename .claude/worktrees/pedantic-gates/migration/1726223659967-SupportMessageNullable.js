const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SupportMessageNullable1726223659967 {
    name = 'SupportMessageNullable1726223659967'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_message" ALTER COLUMN "message" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "support_message" ALTER COLUMN "message" nvarchar(MAX) NOT NULL`);
    }
}
