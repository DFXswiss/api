const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddLimitRequestAcceptedLimit1750087655189 {
    name = 'AddLimitRequestAcceptedLimit1750087655189'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "acceptedLimit" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "acceptedLimit"`);
    }
}
