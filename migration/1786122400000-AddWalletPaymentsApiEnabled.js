/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Partner Payments API gate (GET /v2/kyc/client/payments; the per-user path
 * /kyc/client/users/:id/payments is an additional depth-defense surface behind
 * KYC_CLIENT_COMPANY and is gated by the same flag in the service).
 *
 * Before this change, GET /v2/kyc/client/payments returned PaymentWebhookData /
 * TransactionDetailDto including customer IBANs, wallet addresses, on-chain hashes, amounts
 * and rates, gated by RoleGuard(UserRole.CLIENT_COMPANY) alone. That role is granted to every
 * wallet that has an address on company login (auth.service generateCompanyToken /
 * companySignIn), so any new partner wallet would automatically see the full transaction
 * dump without an explicit enablement decision.
 *
 * This migration adds wallet.paymentsApiEnabled (boolean NOT NULL DEFAULT false) — fail-closed:
 * a new or unknown wallet has no payments API access until ops deliberately flip the flag
 * (via the existing admin PUT /wallet/:id, which maps WalletDto including this field).
 *
 * Backfill: SET paymentsApiEnabled = true WHERE address IS NOT NULL
 *   OR (apiUrl IS NOT NULL AND webhookConfig is valid JSON with payment in True|ConsentOnly|WalletOnly).
 * Matches isValidForWebhook(PAYMENT) / isOptionValid without the flag: address opens pull
 * (companySignIn), apiUrl+delivering payment option opens push. apiUrl alone, payment:'False',
 * NULL webhookConfig, or invalid JSON do not enable.
 *
 * Why not isKycClient: that flag is the wrong predicate. The role CLIENT_COMPANY is granted
 * precisely for wallets that can company-sign-in without being a KYC client
 * (isKycClient = false). A backfill over isKycClient = true would by construction exclude
 * exactly the partners the endpoint was opened for. Because 403 is excluded from WARN logging
 * in exception.filter.ts, that loss of access would have gone unnoticed.
 *
 * After the semantic backfill, if a log row with system=Wallet /
 * subsystem=PaymentsApiEnabledRollback exists, the newest such row may restore disables only
 * (paymentsApiEnabled = false). Ops aborts survive up → down → up; a record never opens access.
 * Why close-only: log rows are creatable via POST /log (BANKING_BOT), so a restore that set
 * true would be an enablement path outside admin PUT /wallet. Pattern: FixFiatOutputValutaDateSerials
 * (audit), but fail-closed on the restore side.
 *
 * Ownership: this migration creates "wallet"."paymentsApiEnabled". down() first persists the
 * current per-wallet flag values into the immutable "log" table (so ops disables after deploy
 * remain reconstructible), then drops only that column. No other row or column is affected.
 *
 * Verified on: a throwaway Postgres 17 database (column add + backfill + drop; up → down → up
 * with existing rows, with/without address and apiUrl, independent of isKycClient). Runs at
 * boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddWalletPaymentsApiEnabled1786122400000 {
  name = 'AddWalletPaymentsApiEnabled1786122400000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "wallet" ADD "paymentsApiEnabled" boolean NOT NULL DEFAULT false`);
    // Preserve both access channels that actually had access today:
    // - address → pull (company login / CLIENT_COMPANY)
    // - apiUrl + delivering webhookConfig.payment → push (isValidForWebhook / isOptionValid)
    // webhookConfig is text; cast only after IS JSON (PG16+, same guard as FinancialLog chart
    // migration) so invalid content never aborts SQL_MIGRATE.
    // WebhookConfigOption values: True | ConsentOnly | WalletOnly (not False).
    await queryRunner.query(`
UPDATE "wallet" SET "paymentsApiEnabled" = true
WHERE "address" IS NOT NULL
   OR ("apiUrl" IS NOT NULL AND "webhookConfig" IS NOT NULL
       AND "webhookConfig" IS JSON
       AND "webhookConfig"::json->>'payment' IN ('True','ConsentOnly','WalletOnly'))
`);
    // If a prior down() left a PaymentsApiEnabledRollback audit, re-apply disables only —
    // never opens access. Log rows are creatable via POST /log, so a true-restore would be
    // an enablement path; close-only still covers ops aborts after deploy. message IS JSON
    // (same guard as FinancialLog chart migration) so invalid content never aborts SQL_MIGRATE.
    // Field types are also checked via jsonb_typeof before cast (id number, paymentsApiEnabled
    // boolean) so a valid-JSON audit with wrong field types cannot abort SQL_MIGRATE either.
    await queryRunner.query(`
UPDATE "wallet" w
SET "paymentsApiEnabled" = false
FROM (
  SELECT jsonb_array_elements(s."message"::jsonb) AS "elem"
  FROM (
    SELECT "message" FROM "log"
    WHERE "system" = 'Wallet' AND "subsystem" = 'PaymentsApiEnabledRollback'
      AND "message" IS JSON
    ORDER BY "id" DESC
    LIMIT 1
  ) s
) e
WHERE w."id" = CASE
    WHEN jsonb_typeof(e."elem" -> 'id') = 'number' THEN (e."elem"->>'id')::int
  END
  AND CASE
    WHEN jsonb_typeof(e."elem" -> 'paymentsApiEnabled') = 'boolean'
    THEN (e."elem"->>'paymentsApiEnabled')::boolean
  END = false
`);
  }

  /**
   * Persist the current paymentsApiEnabled value per wallet into the immutable "log" table,
   * then drop the column.
   *
   * After deploy, ops may flip individual wallets true/false. Dropping without a prior record
   * would destroy those decisions; a later up() re-derives from address/webhookConfig, then
   * re-applies disables only from this audit (true claims are ignored — see up() restore).
   *
   * Fail-closed: the audit INSERT runs before the DROP in the same migration transaction. If
   * the audit write fails, the DROP is never reached and the transaction rolls back both —
   * the column stays until the prior state is durable in "log".
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
SELECT now(), now(), 'Wallet', 'PaymentsApiEnabledRollback', 'Info',
  COALESCE(json_agg(json_build_object(
    'id', "id",
    'paymentsApiEnabled', "paymentsApiEnabled"
  ) ORDER BY "id")::text, '[]')
FROM "wallet"
`);
    await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "paymentsApiEnabled"`);
  }
};
