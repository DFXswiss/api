const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RequestToTransaction1718358661929 {
    name = 'RequestToTransaction1718358661929'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "externalId" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "externalId"`);
    }
}
