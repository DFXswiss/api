const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class rewardTablesStakingRewardVolumeUserPaidRefCredit1645238384373 {
    name = 'rewardTablesStakingRewardVolumeUserPaidRefCredit1645238384373'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_03359a6602ce5796029a29f119c"`);
        await queryRunner.query(`CREATE TABLE "staking_reward" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e6effbcdb0115ed8150a21c9fa9" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_a7c8cd70195d9afad010b595f34" DEFAULT getdate(), "internalId" nvarchar(256) NOT NULL, "inputAmount" float, "inputAsset" nvarchar(256), "inputReferenceAmount" float, "inputReferenceAsset" nvarchar(256), "outputReferenceAmount" float, "outputReferenceAsset" nvarchar(256), "outputAmount" float, "outputAsset" nvarchar(256), "txId" nvarchar(256) NOT NULL, "outputDate" datetime2 NOT NULL, "amountInChf" float, "amountInEur" float, "recipientMail" nvarchar(256), "mailSendDate" float, "fee" float, "inputDate" datetime2, "stakingId" int NOT NULL, CONSTRAINT "UQ_e86e13c7dd32bb153b2e097ecf7" UNIQUE ("internalId"), CONSTRAINT "PK_63b6754f195dbb71232f598485b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "oneRewardPerRouteCheck" ON "staking_reward" ("txId", "stakingId") `);
        await queryRunner.query(`CREATE TABLE "ref_reward" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_a0ddf77eecc09518a0f51587bb4" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_3ddb6f8a281e5e7054e1ed3cfa8" DEFAULT getdate(), "internalId" nvarchar(256) NOT NULL, "inputAmount" float, "inputAsset" nvarchar(256), "inputReferenceAmount" float, "inputReferenceAsset" nvarchar(256), "outputReferenceAmount" float, "outputReferenceAsset" nvarchar(256), "outputAmount" float, "outputAsset" nvarchar(256), "txId" nvarchar(256) NOT NULL, "outputDate" datetime2 NOT NULL, "amountInChf" float, "amountInEur" float, "recipientMail" nvarchar(256), "mailSendDate" float, "userId" int NOT NULL, CONSTRAINT "UQ_f5fbb5fc2683cfbd08e489f0b23" UNIQUE ("internalId"), CONSTRAINT "PK_253758a04ebf93799fef39912f6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "oneRewardPerUserCheck" ON "ref_reward" ("txId", "userId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contribution"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycHash"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "currencyId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "rewardVolume" float CONSTRAINT "DF_554821e29de71e98260a090c0fa" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionAmount" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionCurrency" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "paidRefCredit" float NOT NULL CONSTRAINT "DF_93ae17adf53258cb0851d1723a4" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "UQ_994e7684ed41b9e4abb1bf3d198"`);
        await queryRunner.query(`ALTER TABLE "staking_reward" ADD CONSTRAINT "FK_6d44460770c83668768ff7c3522" FOREIGN KEY ("stakingId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD CONSTRAINT "FK_d4bb01d7afb4b898d88cf8c1367" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP CONSTRAINT "FK_d4bb01d7afb4b898d88cf8c1367"`);
        await queryRunner.query(`ALTER TABLE "staking_reward" DROP CONSTRAINT "FK_6d44460770c83668768ff7c3522"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "UQ_994e7684ed41b9e4abb1bf3d198" UNIQUE ("ref")`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_93ae17adf53258cb0851d1723a4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "paidRefCredit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionCurrency"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "DF_554821e29de71e98260a090c0fa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "rewardVolume"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "currencyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycHash" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contribution" int`);
        await queryRunner.query(`DROP INDEX "oneRewardPerUserCheck" ON "ref_reward"`);
        await queryRunner.query(`DROP TABLE "ref_reward"`);
        await queryRunner.query(`DROP INDEX "oneRewardPerRouteCheck" ON "staking_reward"`);
        await queryRunner.query(`DROP TABLE "staking_reward"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_03359a6602ce5796029a29f119c" FOREIGN KEY ("currencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
