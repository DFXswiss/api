const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFeeActive1699279253111 {
    name = 'addFeeActive1699279253111'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "active" bit NOT NULL CONSTRAINT "DF_51d1e3958bb29c655e605f48e5c" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "DF_51d1e3958bb29c655e605f48e5c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "active"`);
    }
}
