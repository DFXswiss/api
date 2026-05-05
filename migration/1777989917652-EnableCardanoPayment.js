module.exports = class EnableCardanoPayment1777989917652 {
  name = 'EnableCardanoPayment1777989917652';

  async up(queryRunner) {
    await queryRunner.query(`UPDATE "dbo"."asset" SET "paymentEnabled" = 1 WHERE "uniqueName" = 'Cardano/ADA'`);
  }

  async down(queryRunner) {
    await queryRunner.query(`UPDATE "dbo"."asset" SET "paymentEnabled" = 0 WHERE "uniqueName" = 'Cardano/ADA'`);
  }
};
