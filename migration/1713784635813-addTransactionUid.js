const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTransactionUid1713784635813 {
    name = 'addTransactionUid1713784635813'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "uid" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "uid"`);
    }
}
