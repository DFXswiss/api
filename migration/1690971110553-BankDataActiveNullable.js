const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class BankDataActiveNullable1690971110553 {
  name = 'BankDataActiveNullable1690971110553';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP CONSTRAINT "DF_dfe568e239bb915e3f4d75b198e"`);
    await queryRunner.query(`DROP INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data"`);
    await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "active" bit`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data" ("iban") WHERE active = 1`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data"`);
    await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ALTER COLUMN "active" bit NOT NULL`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3706be84e0ad9ca5e474a9a703" ON "dbo"."bank_data" ("iban") WHERE active = 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "dbo"."bank_data" ADD CONSTRAINT "DF_dfe568e239bb915e3f4d75b198e" DEFAULT 1 FOR "active"`,
    );
  }
};
