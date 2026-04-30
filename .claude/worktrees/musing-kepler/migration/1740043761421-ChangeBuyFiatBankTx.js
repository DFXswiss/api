const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangeBuyFiatBankTx1740043761421 {
    name = 'ChangeBuyFiatBankTx1740043761421'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "REL_8c7b5e695c05e78635b8c0c749" ON "dbo"."buy_fiat"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_8c7b5e695c05e78635b8c0c749" ON "dbo"."buy_fiat" ("bankTxId") WHERE ([bankTxId] IS NOT NULL)`);
    }
}
