const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ipLogAddress1677703052796 {
    name = 'ipLogAddress1677703052796'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" ALTER COLUMN "address" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
    }
}
