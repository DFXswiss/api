const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class DepositAddressesFromSeed1680269985226 {
  name = 'DepositAddressesFromSeed1680269985226';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP COLUMN "key"`);
    await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD "accountIndex" int`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit" ("accountIndex", "blockchain") WHERE accountIndex IS NOT NULL`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit"`);
    await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP COLUMN "accountIndex"`);
    await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD "key" nvarchar(256)`);
  }
};
