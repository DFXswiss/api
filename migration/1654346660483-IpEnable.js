const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class IpEnable1654346660483 {
    name = 'IpEnable1654346660483'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ADD "ipEnable" bit NOT NULL CONSTRAINT "DF_055bfa32c7b317c2d310f9c227b" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_055bfa32c7b317c2d310f9c227b"`);
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "ipEnable"`);
    }
}
