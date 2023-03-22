const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addExchangeTx1679056644182 {
    name = 'addExchangeTx1679056644182'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "exchange_tx" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_d34edaadb0f3e488b75af3aaf19" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_4c31c878064cb06102b1d20c7d1" DEFAULT getdate(), "exchange" nvarchar(256) NOT NULL, "type" nvarchar(256) NOT NULL, "externalId" nvarchar(256) NOT NULL, "externalCreated" datetime2, "externalUpdated" datetime2, "status" nvarchar(256), "originalStatus" nvarchar(256), "amount" float, "cost" float, "currency" nvarchar(256), "feeAmount" float, "feeCurrency" nvarchar(256), "method" nvarchar(256), "aClass" nvarchar(256), "asset" nvarchar(256), "network" nvarchar(256), "address" nvarchar(256), "addressTo" nvarchar(256), "addressFrom" nvarchar(256), "refId" nvarchar(256), "txId" nvarchar(256), "tag" nvarchar(256), "tagTo" nvarchar(256), "tagFrom" nvarchar(256), "order" nvarchar(256), "orderTxId" nvarchar(256), "posTxId" nvarchar(256), "pair" nvarchar(256), "orderType" nvarchar(256), "price" float, "vol" float, "margin" float, "leverage" float, "misc" nvarchar(256), "tradeId" nvarchar(256), "symbol" nvarchar(256), "side" nvarchar(256), "takeOrMaker" nvarchar(256), CONSTRAINT "PK_4abc4a04a6254d7c54cb9812030" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a15be765a655a269aa162a5426" ON "exchange_tx" ("exchange", "type", "externalId") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_a15be765a655a269aa162a5426" ON "exchange_tx"`);
        await queryRunner.query(`DROP TABLE "exchange_tx"`);
    }
}
