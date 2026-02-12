const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAktionariatResponse1770600000000 {
    name = 'AddAktionariatResponse1770600000000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "aktionariatResponse" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "aktionariatResponse"`);
    }
}
