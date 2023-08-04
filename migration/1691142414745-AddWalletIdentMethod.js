const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class AddWalletIdentMethod1691142414745 {
  name = 'AddWalletIdentMethod1691142414745';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "identMethod" nvarchar(256)`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "identMethod"`);
  }
};
