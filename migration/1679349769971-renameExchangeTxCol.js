const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class renameExchangeTxCol1679349769971 {
    name = 'renameExchangeTxCol1679349769971'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "exchange_tx.takeOrMaker", "takerOrMaker"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "exchange_tx.takerOrMaker", "takeOrMaker"`);
    }
}
