const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addAddtionalFee1699464913349 {
    name = 'addAddtionalFee1699464913349'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "fixedFee" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "fixedFee"`);
    }
}
