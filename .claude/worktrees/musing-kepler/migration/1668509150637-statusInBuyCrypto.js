const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class statusInBuyCrypto1668509150637 {
  name = 'statusInBuyCrypto1668509150637';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "status" nvarchar(256)`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "status"`);
  }
};
