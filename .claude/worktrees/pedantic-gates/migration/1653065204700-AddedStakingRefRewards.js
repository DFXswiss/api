const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedStakingRefRewards1653065204700 {
    name = 'AddedStakingRefRewards1653065204700'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "staking_ref_reward" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_44c57a2beb293e7039eb24baae8" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_41482dc7130912e0c7e1ee0fd8b" DEFAULT getdate(), "inputAmount" float, "inputAsset" nvarchar(256), "inputReferenceAmount" float, "inputReferenceAsset" nvarchar(256), "outputReferenceAmount" float, "outputReferenceAsset" nvarchar(256), "outputAmount" float, "outputAsset" nvarchar(256), "txId" nvarchar(256), "outputDate" datetime2, "amountInChf" float, "amountInEur" float, "recipientMail" nvarchar(256), "mailSendDate" float, "stakingRefType" nvarchar(256) NOT NULL, "userId" int NOT NULL, "stakingId" int, CONSTRAINT "PK_fda1ba17e2b8218d933967228da" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "paidStakingRefCredit" float NOT NULL CONSTRAINT "DF_eed6aa936c30d687da507471e7a" DEFAULT 0`);
        await queryRunner.query(`DROP INDEX "oneRewardPerRouteCheck" ON "dbo"."staking_reward"`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ALTER COLUMN "txId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ALTER COLUMN "outputDate" datetime2`);
        await queryRunner.query(`DROP INDEX "oneRewardPerUserCheck" ON "dbo"."ref_reward"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ALTER COLUMN "txId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ALTER COLUMN "outputDate" datetime2`);
        await queryRunner.query(`CREATE UNIQUE INDEX "oneRewardPerRouteCheck" ON "dbo"."staking_reward" ("txId", "stakingId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "oneRewardPerUserCheck" ON "dbo"."ref_reward" ("txId", "userId") `);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" ADD CONSTRAINT "FK_fc57074ad97e10f40122b195d3e" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" ADD CONSTRAINT "FK_11a71eb4da3a8bbbc1fd98f0e0b" FOREIGN KEY ("stakingId") REFERENCES "deposit_route"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" DROP CONSTRAINT "FK_11a71eb4da3a8bbbc1fd98f0e0b"`);
        await queryRunner.query(`ALTER TABLE "staking_ref_reward" DROP CONSTRAINT "FK_fc57074ad97e10f40122b195d3e"`);
        await queryRunner.query(`DROP INDEX "oneRewardPerUserCheck" ON "dbo"."ref_reward"`);
        await queryRunner.query(`DROP INDEX "oneRewardPerRouteCheck" ON "dbo"."staking_reward"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ALTER COLUMN "outputDate" datetime2 NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ALTER COLUMN "txId" nvarchar(256) NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "oneRewardPerUserCheck" ON "dbo"."ref_reward" ("txId", "userId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ALTER COLUMN "outputDate" datetime2 NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."staking_reward" ALTER COLUMN "txId" nvarchar(256) NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "oneRewardPerRouteCheck" ON "dbo"."staking_reward" ("txId", "stakingId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "DF_eed6aa936c30d687da507471e7a"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "paidStakingRefCredit"`);
        await queryRunner.query(`DROP TABLE "staking_ref_reward"`);
    }
}
