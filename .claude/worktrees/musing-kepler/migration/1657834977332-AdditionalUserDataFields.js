const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AdditionalUserDataFields1657834977332 {
    name = 'AdditionalUserDataFields1657834977332'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "highRisk" bit`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "complexOrgStructure" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "complexOrgStructure"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "highRisk"`);
    }
}
