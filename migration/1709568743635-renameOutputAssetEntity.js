const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class renameOutputAssetEntity1709568743635 {
    name = 'renameOutputAssetEntity1709568743635'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputAssetEntityId", "outputAssetId"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputReferenceAssetEntityId", "outputReferenceAssetId"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputReferenceAssetId", "outputReferenceAssetEntityId"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.outputAssetId", "outputAssetEntityId"`);
    }
}
