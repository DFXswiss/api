const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class StakingTable1648158906542 {
    name = 'StakingTable1648158906542'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "crypto_staking" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_5cd2e73df5a2b4e7e7d71372c38" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_ec47c38bb9d2007e980662d44e4" DEFAULT getdate(), "inputDate" datetime2 NOT NULL, "inTxId" nvarchar(256) NOT NULL, "inputAmountInChf" float NOT NULL, "inputAmountInEur" float NOT NULL, "inputAmount" float NOT NULL, "inputAsset" nvarchar(255) NOT NULL, "inputMailSendDate" float, "outputAmountInChf" float, "outputAmountInEur" float, "outputAmount" float, "outputAsset" nvarchar(255), "outputMailSendDate" float, "outputDate" datetime2 NOT NULL, "outTxId" nvarchar(256), "payoutType" nvarchar(256) NOT NULL, "isReinvest" bit NOT NULL CONSTRAINT "DF_a363f18283bdc9ce8a3e0460781" DEFAULT 0, "readyToPayout" bit NOT NULL CONSTRAINT "DF_3f04ead942ce0c0c4ba616bd042" DEFAULT 0, "cryptoInputId" int NOT NULL, "stakingRouteId" int NOT NULL, CONSTRAINT "PK_8f3d5ab9222cc54c9c27efd0c49" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_502a4ed5e3971e4b7d16132978" ON "crypto_staking" ("cryptoInputId") WHERE "cryptoInputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "crypto_staking" ADD CONSTRAINT "FK_502a4ed5e3971e4b7d161329782" FOREIGN KEY ("cryptoInputId") REFERENCES "crypto_input"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_staking" ADD CONSTRAINT "FK_8e7533a8e8b59c5fd10742033d4" FOREIGN KEY ("stakingRouteId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_staking" DROP CONSTRAINT "FK_8e7533a8e8b59c5fd10742033d4"`);
        await queryRunner.query(`ALTER TABLE "crypto_staking" DROP CONSTRAINT "FK_502a4ed5e3971e4b7d161329782"`);
        await queryRunner.query(`DROP INDEX "REL_502a4ed5e3971e4b7d16132978" ON "crypto_staking"`);
        await queryRunner.query(`DROP TABLE "crypto_staking"`);
    }
}
