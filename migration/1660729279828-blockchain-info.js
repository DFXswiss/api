const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class blockchainInfo1660729279828 {
    name = 'blockchainInfo1660729279828'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ADD "blockchain" nvarchar(256) NOT NULL CONSTRAINT "DF_0e1dda4bf7f110acc1b1988dc81" DEFAULT 'DeFiChain'`);
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "UQ_119b2d1c1bdccc42057c303c44f"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "nameBlockchain" ON "asset" ("name", "blockchain") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_0e1dda4bf7f110acc1b1988dc81"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "blockchain"`);
        await queryRunner.query(`DROP INDEX "IDX_caebee0c1fa7bff3805c65fd01" ON "link_address"`);
    }
}
