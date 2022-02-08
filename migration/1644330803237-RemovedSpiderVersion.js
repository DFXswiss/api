const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemovedSpiderVersion1644330803237 {
    name = 'RemovedSpiderVersion1644330803237'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "spider_data" DROP COLUMN "version"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "spider_data" ADD "version" nvarchar(256) NOT NULL`);
    }
}
