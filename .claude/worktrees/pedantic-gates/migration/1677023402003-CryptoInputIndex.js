const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoInputIndex1677023402003 {
    name = 'CryptoInputIndex1677023402003'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_6aec38e5c6f47a65ffe49b2c2e" ON "dbo"."crypto_input"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_369a1717646e41f4bad20b4f18" ON "dbo"."crypto_input" ("inTxId", "assetId", "addressAddress", "addressBlockchain") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_369a1717646e41f4bad20b4f18" ON "dbo"."crypto_input"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6aec38e5c6f47a65ffe49b2c2e" ON "dbo"."crypto_input" ("inTxId", "assetId", "routeId", "txSequence") `);
    }
}
