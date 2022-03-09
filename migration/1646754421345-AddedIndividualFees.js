const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedIndividualFees1646754421345 {
    name = 'AddedIndividualFees1646754421345'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "sellFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "stakingFee" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "stakingFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "sellFee"`);
    }
}
