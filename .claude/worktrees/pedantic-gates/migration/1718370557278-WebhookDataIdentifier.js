const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class WebhookDataIdentifier1718370557278 {
    name = 'WebhookDataIdentifier1718370557278'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" ADD "identifier" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."webhook" DROP COLUMN "identifier"`);
    }
}
