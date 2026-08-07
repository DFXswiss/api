/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const WALLET_NAME = 'Bitagent';

/**
 * The AML rule set of the reference wallet (`DFX Bitcoin`), inlined as a literal rather than read
 * from that wallet at runtime: a sub-select would silently follow every later change to the
 * reference wallet, so the value this migration writes would no longer be the value that was
 * reviewed. `3;7;11;16` is `AmlRule.RULE_3;RULE_7;RULE_11;RULE_16` — see
 * `src/subdomains/core/aml/enums/aml-rule.enum.ts`.
 */
const TARGET_AML_RULES = '3;7;11;16';

/**
 * Aligns the AML rule configuration of the `Bitagent` wallet with the `DFX Bitcoin` wallet, so that
 * its customers cannot be assessed more leniently than DFX's own customers.
 *
 * `wallet.amlRules` was `0` (`AmlRule.DEFAULT` — no rule at all) while `DFX Bitcoin` carries
 * `3;7;11;16`. Three of those are tightenings the wallet was missing entirely
 * (`AmlHelperService.getAmlErrors` iterates `wallet.amlRuleList`, `amlRuleQuoteCheck` evaluates the
 * same list at quote time):
 *   - RULE_3  — KYC level 50 required
 *   - RULE_7  — KYC level 50 required for checkout (card) payments
 *   - RULE_16 — mandatory phone call check for buy-crypto on personal accounts
 * RULE_11 is the one relaxation in the set (it waives the KYC level requirement for special IP
 * countries), and it is carried over as well so the two wallets end up with identical semantics
 * rather than the target wallet ending up stricter than the reference.
 *
 * `exceptAmlRules` is cleared in the same statement. It is already NULL on both wallets today, but
 * it is the one column that can neutralise the rules written here — a non-empty value would filter
 * entries straight back out of `amlRuleCheck` — so it is pinned to the reference value instead of
 * being left to whatever a later manual edit put there.
 *
 * Not environment-gated: the wallet is matched by name, which is meaningful in every environment,
 * and a missing row is a plain no-op. `autoTradeApproval`, `isKycClient`, `customKyc` and
 * `identMethod` — the remaining wallet-level levers that AML/KYC code reads — already hold
 * identical values on both wallets and are therefore deliberately left untouched.
 *
 * up():
 *   1. audit-then-update via data-modifying CTEs: lock the wallet row, insert a before/after audit
 *      log row, then update only if the audit insert succeeded (fail-closed)
 *   2. postcondition: no `Bitagent` row may be left off the target configuration, and on PRD the
 *      row must actually exist — a rename would otherwise turn this migration into a silent no-op
 *      that still records itself as executed
 *
 * The update is skipped when the row already matches (`IS DISTINCT FROM`), which makes the
 * migration idempotent: a rerun finds an empty "affected" set, so the audit `HAVING` clause
 * suppresses the insert and the UPDATE changes nothing.
 *
 * down() is a deliberate no-op: restoring the previous, weaker rule set is the dangerous direction
 * for an AML configuration, and it would also overwrite any rules set independently after up() ran.
 * The exact previous value stays available in the up() audit log line (same rationale as
 * DeactivateTradingRules).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AlignBitagentWalletAmlRules1786107329636 {
  name = 'AlignBitagentWalletAmlRules1786107329636';

  /**
   * Writes the reference AML rule set onto the `Bitagent` wallet and asserts the resulting state.
   *
   * EXISTS (SELECT 1 FROM "audit") fail-closes the UPDATE to the audit INSERT: if the insert fails,
   * no row is changed (CONTRIBUTING.md "Auditable mutations — no destructive overwrites
   * (CRITICAL)", before→after audit before the update).
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `
WITH "affected" AS (
  SELECT "id", "amlRules", "exceptAmlRules" FROM "wallet"
  WHERE "name" = $2::varchar
    AND ("amlRules" IS DISTINCT FROM $1::varchar OR "exceptAmlRules" IS NOT NULL)
  FOR UPDATE
),
"audit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'Migration', 'AlignBitagentWalletAmlRules1786107329636', 'Info',
    json_agg(json_build_object(
      'walletId', "id",
      'previousAmlRules', "amlRules",
      'nextAmlRules', $1::varchar,
      'previousExceptAmlRules', "exceptAmlRules",
      'nextExceptAmlRules', NULL::varchar
    ))::text
  FROM "affected"
  HAVING count(*) > 0
  RETURNING 1
)
UPDATE "wallet" w
SET "amlRules" = $1::varchar, "exceptAmlRules" = NULL, "updated" = now()
FROM "affected" a
WHERE w."id" = a."id" AND EXISTS (SELECT 1 FROM "audit");
`,
      [TARGET_AML_RULES, WALLET_NAME],
    );

    // Postcondition, not decoration: without it a suppressed audit insert, a concurrent edit or a
    // renamed wallet would all leave the lenient configuration in place while the migration records
    // itself as executed.
    const [state] = await queryRunner.query(
      `
SELECT
  count(*)::int AS "matchCount",
  count(*) FILTER (WHERE "amlRules" IS DISTINCT FROM $1::varchar OR "exceptAmlRules" IS NOT NULL)::int AS "driftCount"
FROM "wallet"
WHERE "name" = $2::varchar
`,
      [TARGET_AML_RULES, WALLET_NAME],
    );

    if (state.driftCount > 0)
      throw new Error(
        `AlignBitagentWalletAmlRules: ${state.driftCount} '${WALLET_NAME}' wallet(s) did not reach amlRules '${TARGET_AML_RULES}' with an empty exceptAmlRules`,
      );

    // Only PRD is asserted to contain the wallet: dev/loc/CI legitimately have no partner wallets,
    // and failing there would break every fresh database setup.
    if (process.env.ENVIRONMENT === 'prd' && state.matchCount === 0)
      throw new Error(
        `AlignBitagentWalletAmlRules: no wallet named '${WALLET_NAME}' found on PRD — the AML rule alignment was not applied`,
      );
  }

  /**
   * Deliberately does not restore the previous rule set: rolling an AML configuration back to a
   * weaker state is the dangerous direction, and a blind restore would also discard rules set
   * independently after up() ran. The previous value of every changed row is preserved in the up()
   * audit log line. Always a no-op in every environment — no env gate needed.
   */
  async down() {
    // Deliberately no-op — see the class comment. Re-loosening AML rules is an operational
    // decision, not a mechanical inverse.
  }
};
