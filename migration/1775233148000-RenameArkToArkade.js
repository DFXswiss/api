module.exports = class RenameArkToArkade1775233148000 {
  name = 'RenameArkToArkade1775233148000'

  async up(queryRunner) {
    await queryRunner.query(`UPDATE "dbo"."asset" SET "blockchain" = 'Arkade', "uniqueName" = REPLACE("uniqueName", 'Ark/', 'Arkade/') WHERE "blockchain" = 'Ark'`);
    await queryRunner.query(`UPDATE "dbo"."user" SET "addressType" = 'Arkade' WHERE "addressType" = 'Ark'`);
    await queryRunner.query(`UPDATE "dbo"."payout_order" SET "chain" = 'Arkade' WHERE "chain" = 'Ark'`);
    await queryRunner.query(`UPDATE "dbo"."liquidity_order" SET "chain" = 'Arkade' WHERE "chain" = 'Ark'`);
    await queryRunner.query(`UPDATE "dbo"."buy_crypto_batch" SET "blockchain" = 'Arkade' WHERE "blockchain" = 'Ark'`);
    await queryRunner.query(`UPDATE "dbo"."payment_quote" SET "txBlockchain" = 'Arkade' WHERE "txBlockchain" = 'Ark'`);
    await queryRunner.query(`UPDATE "dbo"."ref_reward" SET "targetBlockchain" = 'Arkade' WHERE "targetBlockchain" = 'Ark'`);
  }

  async down(queryRunner) {
    await queryRunner.query(`UPDATE "dbo"."asset" SET "blockchain" = 'Ark', "uniqueName" = REPLACE("uniqueName", 'Arkade/', 'Ark/') WHERE "blockchain" = 'Arkade'`);
    await queryRunner.query(`UPDATE "dbo"."user" SET "addressType" = 'Ark' WHERE "addressType" = 'Arkade'`);
    await queryRunner.query(`UPDATE "dbo"."payout_order" SET "chain" = 'Ark' WHERE "chain" = 'Arkade'`);
    await queryRunner.query(`UPDATE "dbo"."liquidity_order" SET "chain" = 'Ark' WHERE "chain" = 'Arkade'`);
    await queryRunner.query(`UPDATE "dbo"."buy_crypto_batch" SET "blockchain" = 'Ark' WHERE "blockchain" = 'Arkade'`);
    await queryRunner.query(`UPDATE "dbo"."payment_quote" SET "txBlockchain" = 'Ark' WHERE "txBlockchain" = 'Arkade'`);
    await queryRunner.query(`UPDATE "dbo"."ref_reward" SET "targetBlockchain" = 'Ark' WHERE "targetBlockchain" = 'Arkade'`);
  }
};
