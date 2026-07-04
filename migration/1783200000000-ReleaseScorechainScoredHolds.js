/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ReleaseScorechainScoredHolds1783200000000 {
  name = 'ReleaseScorechainScoredHolds1783200000000';

  /**
   * One-time release of the remaining Scorechain holds that carry a REAL risk score (unlike the
   * no-data over-flags cleared in #4076). They were parked on `ScorechainHighRisk` under the old
   * risk threshold of 70, but the threshold was deliberately lowered to 10 (server #635) — a score
   * of ~50 is "average", not "half bad" — so every one of these now clears the gate. Their AML check
   * is reset to re-run through the (now threshold=10) screening, where they pass.
   *
   * Scope (verified on prod 2026-07-03, all `signatureValid=true`):
   *   buy_crypto (Withdrawal, destination address):
   *     127604  MEDIUM_RISK  score 56  (~248 CHF)
   *     127614  MEDIUM_RISK  score 58  (~3'432 CHF)
   *   buy_fiat (Deposit, incoming source tx):
   *     68625   MEDIUM_RISK  score 47  (~2'199 CHF)
   *     68626   HIGH_RISK    score 15  (~188 CHF)   ← consciously released under threshold=10 (15 >= 10)
   *
   * 68626 is a genuine Scorechain HIGH_RISK deposit; it is included by explicit business decision
   * because 15 is still above the lowered threshold. All other holds are score-based mediums.
   *
   * Each UPDATE mirrors the entity's own reset (`BuyCrypto.resetAmlCheck()` / `BuyFiat.resetAmlCheck()`).
   * All four rows are verified early-stage (amlCheck=Pending, comment='ScorechainHighRisk',
   * isComplete=false, and no output / fiatOutput / usedFees / bank batch / used fees), so the service
   * wrappers' `deleteFee` and output-delete steps are no-ops for them — the field reset below is
   * therefore complete and faithful. The guard (`comment` / `amlCheck` / `isComplete`) skips any row
   * whose state changed between identification and deploy. On dfxdev the id lists match nothing → no-op.
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // buy_crypto — mirrors BuyCrypto.resetAmlCheck()
    await queryRunner.query(`
            UPDATE "buy_crypto" SET
                "amlCheck" = NULL,
                "amlReason" = NULL,
                "amlPostProcessed" = false,
                "mailSendDate" = NULL,
                "amountInChf" = NULL,
                "amountInEur" = NULL,
                "absoluteFeeAmount" = NULL,
                "percentFee" = NULL,
                "percentFeeAmount" = NULL,
                "minFeeAmount" = NULL,
                "minFeeAmountFiat" = NULL,
                "totalFeeAmount" = NULL,
                "totalFeeAmountChf" = NULL,
                "inputReferenceAmountMinusFee" = NULL,
                "usedRef" = NULL,
                "refProvision" = NULL,
                "refFactor" = NULL,
                "chargebackDate" = NULL,
                "chargebackRemittanceInfo" = NULL,
                "outputReferenceAmount" = NULL,
                "outputAmount" = NULL,
                "txId" = NULL,
                "outputDate" = NULL,
                "recipientMail" = NULL,
                "status" = 'Created',
                "comment" = NULL,
                "chargebackIban" = NULL,
                "chargebackAllowedDate" = NULL,
                "chargebackAllowedDateUser" = NULL,
                "chargebackAmount" = NULL,
                "chargebackAllowedBy" = NULL,
                "chargebackOutputId" = NULL,
                "priceDefinitionAllowedDate" = NULL,
                "partnerFeeAmount" = NULL,
                "usedPartnerRef" = NULL
            WHERE "id" IN (127604, 127614)
              AND "comment" = 'ScorechainHighRisk'
              AND "amlCheck" = 'Pending'
              AND "isComplete" = false
        `);

    // buy_fiat — mirrors BuyFiat.resetAmlCheck()
    await queryRunner.query(`
            UPDATE "buy_fiat" SET
                "amlCheck" = NULL,
                "amlReason" = NULL,
                "amlPostProcessed" = false,
                "mail2SendDate" = NULL,
                "mail3SendDate" = NULL,
                "percentFee" = NULL,
                "inputReferenceAmountMinusFee" = NULL,
                "percentFeeAmount" = NULL,
                "absoluteFeeAmount" = NULL,
                "amountInChf" = NULL,
                "amountInEur" = NULL,
                "outputReferenceAmount" = NULL,
                "outputAmount" = NULL,
                "minFeeAmount" = NULL,
                "minFeeAmountFiat" = NULL,
                "totalFeeAmount" = NULL,
                "totalFeeAmountChf" = NULL,
                "usedRef" = NULL,
                "refProvision" = NULL,
                "refFactor" = NULL,
                "fiatOutputId" = NULL,
                "outputDate" = NULL,
                "info" = NULL,
                "bankFinishTimestamp" = NULL,
                "bankStartTimestamp" = NULL,
                "bankBatchId" = NULL,
                "usedBank" = NULL,
                "instantSepa" = NULL,
                "remittanceInfo" = NULL,
                "chargebackTxId" = NULL,
                "chargebackDate" = NULL,
                "mailReturnSendDate" = NULL,
                "comment" = NULL,
                "chargebackAddress" = NULL,
                "chargebackAllowedDate" = NULL,
                "chargebackAllowedDateUser" = NULL,
                "chargebackAmount" = NULL,
                "chargebackAllowedBy" = NULL,
                "partnerFeeAmount" = NULL,
                "usedPartnerRef" = NULL,
                "priceSteps" = NULL,
                "priceDefinitionAllowedDate" = NULL,
                "usedFees" = NULL,
                "bankFeeAmount" = NULL,
                "bankFixedFeeAmount" = NULL,
                "bankPercentFeeAmount" = NULL
            WHERE "id" IN (68625, 68626)
              AND "comment" = 'ScorechainHighRisk'
              AND "amlCheck" = 'Pending'
              AND "isComplete" = false
        `);
  }

  /**
   * Irreversible: a one-time AML-check reset of specific rows cannot be restored (the cleared amounts,
   * fees and output fields are recomputed forward by the AML cron). No-op down.
   * @param {QueryRunner} _queryRunner
   */
  async down(_queryRunner) {
    // intentionally empty — see up()
  }
};
