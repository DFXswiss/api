module.exports = class AddArkBtcToBaseFees1773434400000 {
  name = 'AddArkBtcToBaseFees1773434400000';

  async up(queryRunner) {
    // Add Ark/BTC (asset 426) to all Tier2 base fees that use explicit asset lists
    const feeIds = [4, 5, 6, 10, 11, 12, 16, 17, 18];

    for (const feeId of feeIds) {
      await queryRunner.query(
        `UPDATE "dbo"."fee" SET "assets" = "assets" + ';426' WHERE "id" = ${feeId} AND "assets" NOT LIKE '%426%'`,
      );
    }
  }

  async down(queryRunner) {
    const feeIds = [4, 5, 6, 10, 11, 12, 16, 17, 18];

    for (const feeId of feeIds) {
      await queryRunner.query(`UPDATE "dbo"."fee" SET "assets" = REPLACE("assets", ';426', '') WHERE "id" = ${feeId}`);
    }
  }
};
