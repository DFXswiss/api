const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedIndividualBuyFee1646302953368 {
    name = 'AddedIndividualBuyFee1646302953368'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "buyFee" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "buyFee"`);
    }
}
