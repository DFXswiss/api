const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class AssetPricingMetadata1680704008642 {
  name = 'AssetPricingMetadata1680704008642';

  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "asset_pricing_metadata" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e9222ea8d0725ae26d294235192" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_9a864cda24ffea7742d56b15c82" DEFAULT getdate(), "fiatPriceProviderAssetId" nvarchar(255) NOT NULL, "assetId" int NOT NULL, CONSTRAINT "PK_d2028aa87f34e247eb8c4131693" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "REL_fd3165a543312234b2495a5361" ON "asset_pricing_metadata" ("assetId") WHERE "assetId" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "asset_pricing_metadata" ADD CONSTRAINT "FK_fd3165a543312234b2495a53616" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "asset_pricing_metadata" DROP CONSTRAINT "FK_fd3165a543312234b2495a53616"`);
    await queryRunner.query(`DROP INDEX "REL_fd3165a543312234b2495a5361" ON "asset_pricing_metadata"`);
    await queryRunner.query(`DROP TABLE "asset_pricing_metadata"`);
  }
};
