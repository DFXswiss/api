const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addRelatedUsers1701424853056 {
    name = 'addRelatedUsers1701424853056'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "relatedUsers" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "relatedUsers"`);
    }
}
