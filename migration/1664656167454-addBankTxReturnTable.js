const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankTxReturnTable1664656167454 {
    name = 'addBankTxReturnTable1664656167454'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "bank_tx_return" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_97c17871757f1cecf7121391ed4" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_ffeebf01a96f36dc46bde504555" DEFAULT getdate(), "bankTxId" int NOT NULL, CONSTRAINT "PK_c0df73191eed7dea2d8b8bbdfde" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_d9e22bdf9beb60838373b829e9" ON "bank_tx_return" ("bankTxId") WHERE "bankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "bank_tx_return" ADD CONSTRAINT "FK_d9e22bdf9beb60838373b829e9c" FOREIGN KEY ("bankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_return" DROP CONSTRAINT "FK_d9e22bdf9beb60838373b829e9c"`);
        await queryRunner.query(`DROP INDEX "REL_d9e22bdf9beb60838373b829e9" ON "bank_tx_return"`);
        await queryRunner.query(`DROP TABLE "bank_tx_return"`);
    }
}
