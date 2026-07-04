/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ReleaseScorechainNoDataHolds1783120000000 {
    name = 'ReleaseScorechainNoDataHolds1783120000000'

    /**
     * One-time release of buy-crypto withdrawals that were parked on `ScorechainHighRisk` solely because
     * Scorechain had NO data on their (fresh) destination address (NoCoverage / NotFound / 404) — an
     * over-flag corrected in the isHighRisk withdrawal fix (#4070). These are legitimate customer
     * withdrawals with no actual risk signal, so their AML check is reset to re-run through the (now
     * fixed) gate, where they pass.
     *
     * Scope: exactly the 13 held no-data cases identified on prod (2026-07-03). The 2 genuine MEDIUM_RISK
     * holds (127604, 127614) are DELIBERATELY excluded — they carry a real Scorechain score and are
     * tracked for manual compliance review in DFXServer/server#633.
     *
     * This mirrors `resetAmlCheckInternal` → `BuyCrypto.resetAmlCheck()`. All 13 rows are verified to be
     * early-stage (status=Created, amlCheck=Pending, no usedFees, no chargebackOutput, not batched, not
     * complete), so the service method's `deleteFee` and chargeback-output delete are no-ops for them —
     * the field reset below is therefore complete and faithful. The guard (`comment` / `amlCheck`) skips
     * any row whose state changed between identification and deploy. On dfxdev the id list matches
     * nothing (different data) → no-op.
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
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
            WHERE "id" IN (127576, 127585, 127587, 127588, 127590, 127592, 127595, 127600, 127601, 127605, 127606, 127611, 127613)
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
}
