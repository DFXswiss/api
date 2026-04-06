/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Reset stuck Ethereum/DAI redundancy pipeline and order.
 *
 * Pipeline 58786 (rule 82, Ethereum/DAI) has been stuck InProgress since 2026-04-02.
 * The underlying Ethereum transaction 0x1de1585e...721a reverted with "Dai/insufficient-balance"
 * due to a Number↔Wei precision rounding issue (parseFloat loses precision on 18-decimal tokens,
 * toWeiAmount rounds up by 1-2 wei, exceeding actual on-chain balance).
 *
 * The completion check (checkWithdrawCompletion) only looks for a matching Binance deposit
 * and never detects the failed on-chain TX, so the order stays InProgress forever.
 *
 * Fix: Set order 118943 and pipeline 58786 to Failed so the rule returns to Active
 * and a new pipeline can be created with corrected amounts.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResetStuckDaiRedundancyPipeline1775501057000 {
  name = 'ResetStuckDaiRedundancyPipeline1775501057000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const orderId = 118943;
    const pipelineId = 58786;
    const ruleId = 82;

    console.log('=== Reset stuck Ethereum/DAI redundancy pipeline ===\n');

    // Verify current state
    const order = await queryRunner.query(`
      SELECT id, status, correlationId, inputAmount, inputAsset
      FROM dbo.liquidity_management_order
      WHERE id = ${orderId}
    `);

    if (order.length === 0) {
      console.log('ERROR: Order not found. Aborting.');
      return;
    }

    if (order[0].status !== 'InProgress') {
      console.log(`Order status is '${order[0].status}', not InProgress. Skipping.`);
      return;
    }

    console.log('Current order state:', JSON.stringify(order[0], null, 2));

    // Fail the order
    console.log('\nSetting order to Failed...');
    await queryRunner.query(`
      UPDATE dbo.liquidity_management_order
      SET
        status = 'Failed',
        errorMessage = 'On-chain TX reverted: Dai/insufficient-balance (Number/Wei precision rounding). Reset by migration.',
        updated = GETDATE()
      WHERE id = ${orderId}
    `);

    // Fail the pipeline
    console.log('Setting pipeline to Failed...');
    await queryRunner.query(`
      UPDATE dbo.liquidity_management_pipeline
      SET
        status = 'Failed',
        updated = GETDATE()
      WHERE id = ${pipelineId}
    `);

    // Reset rule to Active
    console.log('Setting rule to Active...');
    await queryRunner.query(`
      UPDATE dbo.liquidity_management_rule
      SET
        status = 'Active',
        updated = GETDATE()
      WHERE id = ${ruleId}
    `);

    // Verify final state
    console.log('\n=== Verification ===');
    const finalOrder = await queryRunner.query(`
      SELECT id, status, errorMessage FROM dbo.liquidity_management_order WHERE id = ${orderId}
    `);
    const finalPipeline = await queryRunner.query(`
      SELECT id, status FROM dbo.liquidity_management_pipeline WHERE id = ${pipelineId}
    `);
    const finalRule = await queryRunner.query(`
      SELECT id, status, optimal, maximal FROM dbo.liquidity_management_rule WHERE id = ${ruleId}
    `);
    console.log('Order:', JSON.stringify(finalOrder[0], null, 2));
    console.log('Pipeline:', JSON.stringify(finalPipeline[0], null, 2));
    console.log('Rule:', JSON.stringify(finalRule[0], null, 2));

    console.log('\n=== Migration Complete ===');
    console.log('Rule 82 is now Active. The next LM cron cycle will create a new pipeline.');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      UPDATE dbo.liquidity_management_order
      SET status = 'InProgress', errorMessage = NULL, updated = GETDATE()
      WHERE id = 118943
    `);
    await queryRunner.query(`
      UPDATE dbo.liquidity_management_pipeline
      SET status = 'InProgress', updated = GETDATE()
      WHERE id = 58786
    `);
    await queryRunner.query(`
      UPDATE dbo.liquidity_management_rule
      SET status = 'Processing', updated = GETDATE()
      WHERE id = 82
    `);
  }
};
