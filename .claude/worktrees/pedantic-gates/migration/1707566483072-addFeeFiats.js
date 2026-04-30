const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addFeeFiats1707566483072 {
    name = 'addFeeFiats1707566483072'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "fiats" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "fiats"`);
    }
}
