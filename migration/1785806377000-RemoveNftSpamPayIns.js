/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Removes pay-in rows created from NFT mass-airdrop spam, together with their bare transaction
 * shells.
 *
 * The Alchemy address-activity webhook delivers ERC-721/1155 transfers with the raw event data
 * (tokenId ++ value) in rawContract.rawValue; the register strategy used to parse that as an
 * 18-decimal token amount, so every spam mint landed in crypto_input with an impossible amount
 * (~1.16e59 = (2^256 + 1) / 1e18 for the ubiquitous tokenId=1/value=1 mints), no matchable asset
 * (assetId NULL -> status 'Failed', terminal), no route, and one bare transaction row
 * (sourceType 'CryptoInput', no user). The register-side cause is fixed in the same release
 * (NFT categories are no longer mapped into the pay-in flow); this migration removes the
 * accumulated rows, whose amounts poison any unfiltered aggregate over crypto_input.
 *
 * Selection is deliberately over-determined — every predicate must hold:
 *   - "assetId" IS NULL AND "status" = 'Failed' AND "routeId" IS NULL (never entered processing)
 *   - "amount" > 1e30: no real token normalizes anywhere near this (trillion-supply 18-decimal
 *     tokens reach ~1e15); every observed spam variant parses to > 1e40
 *   - not referenced by buy_crypto/buy_fiat/crypto_staking (the only FK owners on crypto_input)
 *
 * Transaction shells are deleted only when they belong to a deleted spam pay-in AND are provably
 * bare: sourceType 'CryptoInput', no user/userData/request, and not referenced by any table that
 * ever gained an FK to "transaction" (explicit NOT EXISTS instead of trusting FK constraints:
 * prod predates some constraints, and a constraint violation would abort the boot migration run).
 * A row failing any guard is silently kept, not an error — cleanup skips, boot proceeds.
 *
 * Auditable-mutations compliance (CONTRIBUTING.md, CRITICAL): full before-images of every deleted
 * row are persisted to "crypto_input_nft_spam_before_image" / "transaction_nft_spam_before_image"
 * (same pattern as AddDenarioPermanentRef), plus a count summary into "log". The before-image
 * tables intentionally survive this migration; dropping them later is an operational decision.
 * All statements run inside the migration transaction, so a failure in any step rolls back the
 * whole cleanup (fail closed). No ENV guard: the predicates are environment-neutral and an empty
 * match set is a no-op.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RemoveNftSpamPayIns1785806377000 {
  name = 'RemoveNftSpamPayIns1785806377000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
CREATE TABLE "crypto_input_nft_spam_before_image" AS
SELECT ci.* FROM "crypto_input" ci
WHERE ci."assetId" IS NULL
  AND ci."status" = 'Failed'
  AND ci."routeId" IS NULL
  AND ci."amount" > 1e30
  AND NOT EXISTS (SELECT 1 FROM "buy_crypto" bc WHERE bc."cryptoInputId" = ci."id")
  AND NOT EXISTS (SELECT 1 FROM "buy_fiat" bf WHERE bf."cryptoInputId" = ci."id")
  AND NOT EXISTS (SELECT 1 FROM "crypto_staking" cs WHERE cs."cryptoInputId" = ci."id")
`);

    await queryRunner.query(`
CREATE TABLE "transaction_nft_spam_before_image" AS
SELECT t.* FROM "transaction" t
WHERE t."id" IN (SELECT "transactionId" FROM "crypto_input_nft_spam_before_image" WHERE "transactionId" IS NOT NULL)
  AND t."sourceType" = 'CryptoInput'
  AND t."userId" IS NULL
  AND t."userDataId" IS NULL
  AND t."requestId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "bank_tx" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "bank_tx_repeat" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "bank_tx_return" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "buy_crypto" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "buy_fiat" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "checkout_tx" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "custody_order" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "mros_transactions_transaction" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "ref_reward" x WHERE x."transactionId" = t."id" OR x."sourceTransactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "support_issue" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "transaction_aml_check" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "transaction_risk_assessment" x WHERE x."transactionId" = t."id")
  AND NOT EXISTS (
    SELECT 1 FROM "crypto_input" ci WHERE ci."transactionId" = t."id"
      AND ci."id" NOT IN (SELECT "id" FROM "crypto_input_nft_spam_before_image")
  )
`);

    await queryRunner.query(`
INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
SELECT now(), now(), 'Migration', 'RemoveNftSpamPayIns1785806377000', 'Info',
  json_build_object(
    'deletedCryptoInputs', (SELECT count(*) FROM "crypto_input_nft_spam_before_image"),
    'deletedTransactions', (SELECT count(*) FROM "transaction_nft_spam_before_image"),
    'minCryptoInputId', (SELECT min("id") FROM "crypto_input_nft_spam_before_image"),
    'maxCryptoInputId', (SELECT max("id") FROM "crypto_input_nft_spam_before_image")
  )::text
`);

    await queryRunner.query(`
DELETE FROM "crypto_input" WHERE "id" IN (SELECT "id" FROM "crypto_input_nft_spam_before_image")
`);

    await queryRunner.query(`
DELETE FROM "transaction" WHERE "id" IN (SELECT "id" FROM "transaction_nft_spam_before_image")
`);
  }

  /**
   * Restores every deleted row from the before-image tables (transaction first — crypto_input
   * carries the FK), then drops the before-images: after the restore the rows themselves are the
   * recoverable state again. Explicit ids are safe to re-insert; the id sequences were never
   * rewound. Only rows still absent are restored, so a partial earlier restore does not conflict.
   * Note: a later schema change to either table would break the positional re-insert — this
   * rollback is meant for the release window, not as a long-term restore path.
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
INSERT INTO "transaction"
SELECT b.* FROM "transaction_nft_spam_before_image" b
WHERE NOT EXISTS (SELECT 1 FROM "transaction" t WHERE t."id" = b."id")
`);

    await queryRunner.query(`
INSERT INTO "crypto_input"
SELECT b.* FROM "crypto_input_nft_spam_before_image" b
WHERE NOT EXISTS (SELECT 1 FROM "crypto_input" ci WHERE ci."id" = b."id")
`);

    await queryRunner.query(`DROP TABLE "transaction_nft_spam_before_image"`);
    await queryRunner.query(`DROP TABLE "crypto_input_nft_spam_before_image"`);
  }
};
