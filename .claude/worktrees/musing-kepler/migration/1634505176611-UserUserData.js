const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UserUserData1634505176611 {
    name = 'UserUserData1634505176611'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "nameCheckOverrideDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "nameCheckOverrideComment"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_e1d9a9f5c2249608116e8aa8fc0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycFailure"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycCustomerId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "btcValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "usedRef" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "refFeePercent" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "refFeeValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "usedWallet" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "walletFeePercent" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "walletFeeValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "dfxFeePercent" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "dfxFeeValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "refFeeAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "walletFeeAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "dfxFeeAssetId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycState" nvarchar(256) NOT NULL CONSTRAINT "DF_ab257bb00ad8dfb36f58752d4b9" DEFAULT 'NA'`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "depositLimit" float NOT NULL CONSTRAINT "DF_008a555620164eed6e1107d9814" DEFAULT 45000`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "currencyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD CONSTRAINT "FK_d488b09dc3bd45fa42ca92ffd83" FOREIGN KEY ("refFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD CONSTRAINT "FK_d15e290a796a3d585e9042f7dd9" FOREIGN KEY ("walletFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD CONSTRAINT "FK_a73327caf16b4efd8424098f277" FOREIGN KEY ("dfxFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD CONSTRAINT "FK_19ab0596b1fab6a44be5491ffb4" FOREIGN KEY ("currencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP CONSTRAINT "FK_19ab0596b1fab6a44be5491ffb4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP CONSTRAINT "FK_a73327caf16b4efd8424098f277"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP CONSTRAINT "FK_d15e290a796a3d585e9042f7dd9"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP CONSTRAINT "FK_d488b09dc3bd45fa42ca92ffd83"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "currencyId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_008a555620164eed6e1107d9814"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "depositLimit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_ab257bb00ad8dfb36f58752d4b9"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycState"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "dfxFeeAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "walletFeeAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "refFeeAssetId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "dfxFeeValue"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "dfxFeePercent"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "walletFeeValue"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "walletFeePercent"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "usedWallet"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "refFeeValue"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "refFeePercent"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "usedRef"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "btcValue"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycCustomerId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycFailure" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "DF_e1d9a9f5c2249608116e8aa8fc0" DEFAULT 0 FOR "kycFailure"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "nameCheckOverrideComment" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "nameCheckOverrideDate" datetime2`);
    }
}
