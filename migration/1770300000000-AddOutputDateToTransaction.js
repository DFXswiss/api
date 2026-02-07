/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddOutputDateToTransaction1770300000000 {
  name = 'AddOutputDateToTransaction1770300000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "outputDate" datetime2`);

    // Populate from buy_crypto
    await queryRunner.query(`
      UPDATE t
      SET t."outputDate" = bc."outputDate"
      FROM "dbo"."transaction" t
      INNER JOIN "dbo"."buy_crypto" bc ON bc."transactionId" = t."id"
      WHERE bc."outputDate" IS NOT NULL
    `);

    // Populate from buy_fiat
    await queryRunner.query(`
      UPDATE t
      SET t."outputDate" = bf."outputDate"
      FROM "dbo"."transaction" t
      INNER JOIN "dbo"."buy_fiat" bf ON bf."transactionId" = t."id"
      WHERE bf."outputDate" IS NOT NULL
    `);

    // Populate from ref_reward
    await queryRunner.query(`
      UPDATE t
      SET t."outputDate" = rr."outputDate"
      FROM "dbo"."transaction" t
      INNER JOIN "dbo"."ref_reward" rr ON rr."transactionId" = t."id"
      WHERE rr."outputDate" IS NOT NULL
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "outputDate"`);
  }
};
