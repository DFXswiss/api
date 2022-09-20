const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addAmlReason1663343755659 {
    name = 'addAmlReason1663343755659'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "amlReason" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "amlReason"`);
    }
}
