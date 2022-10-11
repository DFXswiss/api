const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class assetChainId1665408086368 {
    name = 'assetChainId1665408086368'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ALTER COLUMN "chainId" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ALTER COLUMN "chainId" int`);
    }
}
