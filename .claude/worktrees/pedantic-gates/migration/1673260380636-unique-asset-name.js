const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class uniqueAssetName1673260380636 {
  name = 'uniqueAssetName1673260380636';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "asset" ADD "uniqueName" nvarchar(256)`);
    await queryRunner.query(`UPDATE "asset" SET uniqueName = CONCAT(blockchain, '/', name)`);
    await queryRunner.query(`ALTER TABLE "asset" ALTER COLUMN "uniqueName" nvarchar(256) NOT NULL`);
    await queryRunner.query(`ALTER TABLE "asset" ADD "description" nvarchar(256)`);
    await queryRunner.query(
      `ALTER TABLE "asset" ADD "comingSoon" bit NOT NULL CONSTRAINT "DF_835c06d69dccf1a3a5160c4059d" DEFAULT 0`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_835c06d69dccf1a3a5160c4059d"`);
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "comingSoon"`);
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "description"`);
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "uniqueName"`);
  }
};
