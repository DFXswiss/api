const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddForeignName1736346664324 {
    name = 'AddForeignName1736346664324'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ADD "foreignName" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "foreignName"`);
    }
}
