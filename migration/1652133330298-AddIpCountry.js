const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddIpCountry1652133330298 {
    name = 'AddIpCountry1652133330298'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "ipCountry" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "ipCountry"`);
    }
}
