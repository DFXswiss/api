const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class blockchainInfo1660729279828 {
    name = 'blockchainInfo1660729279828'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ADD "blockchain" nvarchar(256) NOT NULL CONSTRAINT "DF_0e1dda4bf7f110acc1b1988dc81" DEFAULT 'DeFiChain'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_0e1dda4bf7f110acc1b1988dc81"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "blockchain"`);
    }
}
