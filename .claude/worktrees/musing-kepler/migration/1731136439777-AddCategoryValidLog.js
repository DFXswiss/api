const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCategoryValidLog1731136439777 {
    name = 'AddCategoryValidLog1731136439777'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "log" ADD "category" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "log" ADD "valid" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "valid"`);
        await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "category"`);
    }
}
