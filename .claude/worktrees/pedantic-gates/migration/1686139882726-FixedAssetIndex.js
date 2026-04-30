const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class FixedAssetIndex1686139882726 {
  name = 'FixedAssetIndex1686139882726';

  async up(queryRunner) {
    await queryRunner.query(`DROP INDEX "nameTypeBlockchain" ON "dbo"."asset"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_83f52471fd746482b83b20f51b" ON "dbo"."asset" ("dexName", "type", "blockchain") `,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "IDX_83f52471fd746482b83b20f51b" ON "dbo"."asset"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "nameTypeBlockchain" ON "dbo"."asset" ("name", "type", "blockchain") `,
    );
  }
};
