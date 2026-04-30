const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class WalletAddFraudWarning1738429095584 {
    name = 'WalletAddFraudWarning1738429095584'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "displayFraudWarning" bit NOT NULL CONSTRAINT "DF_ada0d1d89d0c68b4ed3bbc71ff4" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_ada0d1d89d0c68b4ed3bbc71ff4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "displayFraudWarning"`);
    }
}
