const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankTxRepeatTable1664968683394 {
    name = 'addBankTxRepeatTable1664968683394'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "bank_tx_repeat" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_0e12daa90f36e01e4fde706a574" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_c015290f9f9cb210694f0de26a5" DEFAULT getdate(), "bankTxId" int NOT NULL, CONSTRAINT "PK_1007a7041835ff298a818999556" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_9265a19ab44e83ee134738735f" ON "bank_tx_repeat" ("bankTxId") WHERE "bankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD CONSTRAINT "FK_9265a19ab44e83ee134738735f3" FOREIGN KEY ("bankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP CONSTRAINT "FK_9265a19ab44e83ee134738735f3"`);
        await queryRunner.query(`DROP INDEX "REL_9265a19ab44e83ee134738735f" ON "bank_tx_repeat"`);
        await queryRunner.query(`DROP TABLE "bank_tx_repeat"`);
    }
}
