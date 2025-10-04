/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddWalletAppTable1759416120438 {
    name = 'AddWalletAppTable1759416120438'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "wallet_app" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_4433d4e020e6e8b6530febdb34d" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_df6815e3c088cc82bd0eeca8978" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "websiteUrl" nvarchar(256), "iconUrl" nvarchar(256) NOT NULL, "deepLink" nvarchar(256), "hasActionDeepLink" bit, "appStoreUrl" nvarchar(MAX), "playStoreUrl" nvarchar(MAX), "recommended" bit, "blockchains" nvarchar(MAX), "assets" nvarchar(256), "semiCompatible" bit, "active" bit NOT NULL CONSTRAINT "DF_3694420a3660b5ee051dc8a5356" DEFAULT 1, CONSTRAINT "UQ_826231c4b3e08d520e941f48b64" UNIQUE ("name"), CONSTRAINT "PK_d7689dbb2b43fd6f50d2f70570a" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "wallet_app"`);
    }
}
