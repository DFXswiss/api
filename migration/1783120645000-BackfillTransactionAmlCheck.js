/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Data-only migration (INSERT-only, no schema change): seeds one "genesis" amlCheck-history row per
 * currently-OPEN BuyCrypto / BuyFiat so the audit trail is not blind to state predating the feature.
 *
 * "Open" = has an actionable amlCheck and is not yet completed: `amlCheck IS NOT NULL AND isComplete = false`.
 * (Closed/completed transactions are intentionally excluded — high volume, low audit value.)
 *
 * Genesis row: source='Backfill', previousAmlCheck=NULL (no prior state is known), amlCheck = the current
 * value, and amlReason/amlResponsible/comment/priceDefinitionAllowedDate/highRisk copied as-is.
 *
 * NOTE ON TIMESTAMP: `created` (and `updated`) are set to the transaction row's own `updated` column. This
 * is only a PROXY for when the state was last set — it is NOT the true amlCheck decision time. Auditors
 * must not over-trust it: genuine decision timestamps only exist for rows written after this feature shipped.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BackfillTransactionAmlCheck1783120645000 {
    name = 'BackfillTransactionAmlCheck1783120645000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`INSERT INTO "transaction_aml_check" ("created", "updated", "entityType", "entityId", "source", "previousAmlCheck", "amlCheck", "previousAmlReason", "amlReason", "amlResponsible", "comment", "priceDefinitionAllowedDate", "highRisk", "transactionId") SELECT "updated", "updated", 'BuyCrypto', "id", 'Backfill', NULL, "amlCheck", NULL, "amlReason", "amlResponsible", "comment", "priceDefinitionAllowedDate", "highRisk", "transactionId" FROM "buy_crypto" WHERE "amlCheck" IS NOT NULL AND "isComplete" = false AND "transactionId" IS NOT NULL`);
        await queryRunner.query(`INSERT INTO "transaction_aml_check" ("created", "updated", "entityType", "entityId", "source", "previousAmlCheck", "amlCheck", "previousAmlReason", "amlReason", "amlResponsible", "comment", "priceDefinitionAllowedDate", "highRisk", "transactionId") SELECT "updated", "updated", 'BuyFiat', "id", 'Backfill', NULL, "amlCheck", NULL, "amlReason", "amlResponsible", "comment", "priceDefinitionAllowedDate", "highRisk", "transactionId" FROM "buy_fiat" WHERE "amlCheck" IS NOT NULL AND "isComplete" = false AND "transactionId" IS NOT NULL`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "transaction_aml_check" WHERE "source" = 'Backfill'`);
    }
}
