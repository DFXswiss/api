const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ipLogAddressRemove1677706598544 {
    name = 'ipLogAddressRemove1677706598544'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" ALTER COLUMN "address" nvarchar(256)`);
    }
}
