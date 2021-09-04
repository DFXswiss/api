const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class assetChainId1630752818367 {
    name = 'assetChainId1630752818367'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "chainId" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "chainId"`);
    }
}
