const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class BankTxUltimateAddress1692871401157 {
  name = 'BankTxUltimateAddress1692871401157';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "ultimateAddressLine1" nvarchar(256)`);
    await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "ultimateAddressLine2" nvarchar(256)`);
    await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "ultimateCountry" nvarchar(256)`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "ultimateCountry"`);
    await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "ultimateAddressLine2"`);
    await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "ultimateAddressLine1"`);
  }
};
