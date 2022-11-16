const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addCustomKyc1668519616316 {
    name = 'addCustomKyc1668519616316'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "customKyc" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "customKyc"`);
    }
}
