const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class renameWalletDescription1664983634440 {
    name = 'renameWalletDescription1664983634440'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "wallet.description", "name"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "wallet.name", "description"`);
    }
}
