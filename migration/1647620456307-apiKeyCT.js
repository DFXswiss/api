const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class apiKeyCT1647620456307 {
    name = 'apiKeyCT1647620456307'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "apiKeyCT" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "apiKeyCT"`);
    }
}
