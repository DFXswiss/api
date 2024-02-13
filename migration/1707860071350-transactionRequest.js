const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class transactionRequest1707860071350 {
    name = 'transactionRequest1707860071350'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "transaction_request" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_6c23f9a8920764e21e85c432819" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_77f9de123503c6f179b8e7d4ad0" DEFAULT getdate(), "routeId" int NOT NULL, "fee" float NOT NULL, "minFee" float NOT NULL, "minVolume" float NOT NULL, "maxVolume" float NOT NULL, "amount" float NOT NULL, "sourceId" int NOT NULL, "targetId" int NOT NULL, "minFeeTarget" float NOT NULL, "minVolumeTarget" float NOT NULL, "maxVolumeTarget" float NOT NULL, "exchangeRate" float NOT NULL, "rate" float NOT NULL, "estimatedAmount" float NOT NULL, "paymentRequest" nvarchar(255), "paymentLink" nvarchar(255), "isValid" bit NOT NULL, "error" nvarchar(255), "type" nvarchar(255) NOT NULL, CONSTRAINT "PK_92f7cd60c08a37010e10f274a47" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "transaction_request"`);
    }
}
