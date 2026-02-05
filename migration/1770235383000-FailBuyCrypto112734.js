/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Set BuyCrypto 112734 to Fail status retroactively.
 *
 * This transaction was incorrectly processed and needs to be marked as failed
 * as if it never passed AML check.
 *
 * BuyCrypto: 112734
 * Transaction: 298950
 * UserData: 370625
 * Amount: 1945.74 CHF (2120 EUR)
 *
 * Note: The blockchain transaction (3.23 BNB) was already executed.
 * This migration only corrects the database records.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FailBuyCrypto1127341770235383000 {
  name = 'FailBuyCrypto1127341770235383000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const buyCryptoId = 112734;
    const transactionId = 298950;
    const userDataId = 370625;
    const amountInChf = 1945.74;

    console.log('=== Fail BuyCrypto 112734 Retroactively ===\n');

    // Verify current state
    const currentBuyCrypto = await queryRunner.query(`
      SELECT id, amlCheck, amlReason, status, outputAmount, txId, transactionId
      FROM dbo.buy_crypto
      WHERE id = ${buyCryptoId}
    `);

    if (currentBuyCrypto.length === 0) {
      console.log('ERROR: BuyCrypto not found. Aborting.');
      return;
    }

    const bc = currentBuyCrypto[0];
    console.log('Current BuyCrypto state:');
    console.log(`  ID: ${bc.id}`);
    console.log(`  amlCheck: ${bc.amlCheck}`);
    console.log(`  amlReason: ${bc.amlReason}`);
    console.log(`  status: ${bc.status}`);
    console.log(`  outputAmount: ${bc.outputAmount}`);
    console.log(`  txId: ${bc.txId}`);
    console.log('');

    if (bc.amlCheck === 'Fail') {
      console.log('BuyCrypto already set to Fail. Skipping.');
      return;
    }

    // 1. Update buy_crypto
    console.log('1. Updating buy_crypto...');
    await queryRunner.query(`
      UPDATE dbo.buy_crypto
      SET
        amlCheck = 'Fail',
        amlReason = 'HighRiskBlocked',
        percentFee = NULL,
        inputReferenceAmountMinusFee = NULL,
        outputReferenceAmount = NULL,
        outputAmount = NULL,
        txId = NULL,
        outputDate = NULL,
        usedRef = NULL,
        refProvision = NULL,
        refFactor = NULL,
        percentFeeAmount = NULL,
        absoluteFeeAmount = NULL,
        batchId = NULL,
        minFeeAmount = NULL,
        minFeeAmountFiat = NULL,
        totalFeeAmount = NULL,
        totalFeeAmountChf = NULL,
        highRisk = NULL,
        usedFees = NULL,
        blockchainFee = NULL,
        priceSteps = NULL,
        priceDefinitionAllowedDate = NULL,
        networkStartFeeAmount = NULL,
        bankFeeAmount = NULL,
        liquidityPipelineId = NULL,
        updated = GETDATE()
      WHERE id = ${buyCryptoId}
    `);
    console.log('  buy_crypto updated.');

    // 2. Update transaction
    console.log('2. Updating transaction...');
    await queryRunner.query(`
      UPDATE dbo.[transaction]
      SET
        amlCheck = NULL,
        amountInChf = NULL,
        highRisk = NULL,
        assets = NULL,
        eventDate = NULL,
        amlType = NULL,
        updated = GETDATE()
      WHERE id = ${transactionId}
    `);
    console.log('  transaction updated.');

    // 3. Update user_data volumes
    console.log('3. Updating user_data volumes...');
    const currentUserData = await queryRunner.query(`
      SELECT id, buyVolume, annualBuyVolume, monthlyBuyVolume
      FROM dbo.user_data
      WHERE id = ${userDataId}
    `);

    if (currentUserData.length > 0) {
      const ud = currentUserData[0];
      console.log(
        `  Current volumes: buy=${ud.buyVolume}, annual=${ud.annualBuyVolume}, monthly=${ud.monthlyBuyVolume}`,
      );

      await queryRunner.query(`
        UPDATE dbo.user_data
        SET
          buyVolume = buyVolume - ${amountInChf},
          annualBuyVolume = annualBuyVolume - ${amountInChf},
          monthlyBuyVolume = monthlyBuyVolume - ${amountInChf},
          updated = GETDATE()
        WHERE id = ${userDataId}
      `);
      console.log(`  Subtracted ${amountInChf} CHF from all volume fields.`);
    }

    // Verify final state
    console.log('\n=== Verification ===');
    const finalBuyCrypto = await queryRunner.query(`
      SELECT id, amlCheck, amlReason, outputAmount, txId, chargebackDate
      FROM dbo.buy_crypto
      WHERE id = ${buyCryptoId}
    `);
    const finalTx = await queryRunner.query(`
      SELECT id, amlCheck, amountInChf
      FROM dbo.[transaction]
      WHERE id = ${transactionId}
    `);
    const finalUserData = await queryRunner.query(`
      SELECT id, buyVolume, annualBuyVolume, monthlyBuyVolume
      FROM dbo.user_data
      WHERE id = ${userDataId}
    `);

    console.log('BuyCrypto:', JSON.stringify(finalBuyCrypto[0], null, 2));
    console.log('Transaction:', JSON.stringify(finalTx[0], null, 2));
    console.log('UserData volumes:', JSON.stringify(finalUserData[0], null, 2));

    console.log('\n=== Migration Complete ===');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    console.log('Down migration not implemented. Manual intervention required to restore data.');
  }
};
