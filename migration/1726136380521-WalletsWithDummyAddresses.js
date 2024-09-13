const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class WalletsWithDummyAddresses1726136380521 {
    name = 'WalletsWithDummyAddresses1726136380521'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" ADD "usesDummyAddresses" bit NOT NULL CONSTRAINT "DF_469a8373d708cd81c9cd6319c2d" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "DF_469a8373d708cd81c9cd6319c2d"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "usesDummyAddresses"`);
    }
}
