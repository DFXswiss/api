const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class Added2ndOutTxId1650984785735 {
    name = 'Added2ndOutTxId1650984785735'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" ADD "outTxId2" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" DROP COLUMN "outTxId2"`);
    }
}
