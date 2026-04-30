const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSymbol3Country1727073411626 {
    name = 'AddSymbol3Country1727073411626'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ADD "symbol3" nvarchar(10)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "symbol3"`);
    }
}
