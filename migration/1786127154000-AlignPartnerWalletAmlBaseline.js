/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * RULE_3 (KYC level 50) + RULE_7 (KYC level 50 for checkout/card payments) — the set every
 * DFX-owned wallet carries. Inlined as a literal rather than read from a reference wallet at
 * runtime: a sub-select would silently follow every later change to the reference, so the value
 * this migration writes would no longer be the value that was reviewed (same rationale as
 * AlignBitagentWalletAmlRules).
 */
const TARGET_AML_RULES = '3;7';

/**
 * Partner wallets matched by name, which is meaningful in every environment. `NBZ` currently
 * carries `'3;7;14'` (baseline plus the RULE_14 "no phoneCallCheck" relaxation); the other eight
 * carry `'0'` (`AmlRule.DEFAULT` — no tightening rule at all).
 */
const BASELINE_WALLET_NAMES = [
  'NBZ',
  'Multisig',
  'Coinsnap',
  'Arkade',
  'Faceless',
  'Youtrust',
  'Edge',
  'Eternl',
  'Denario',
];

/**
 * Two partner wallets whose `name` values are natural-person names that must not be published in
 * this repository. Matched by id instead; the pre-state guard `"amlRules" = '14'` keeps the
 * id-match from touching unrelated rows on databases where these ids belong to different wallets.
 * On PRD the postcondition still asserts both rows reached the target.
 */
const BASELINE_WALLET_IDS = [24, 25];

/** Pre-state required for the id-matched rows (RULE_14 alone). */
const REQUIRED_CURRENT_AML_RULES = '14';

/**
 * Only `exceptAmlRules` is cleared on this wallet; its `amlRules = '3'` is a deliberate partner
 * configuration and stays untouched. `exceptAmlRules` filters rules back out at every
 * `amlRuleCheck` call site — including rules arriving via asset, IBAN country or nationality —
 * so a wallet-level `'13'` disables RULE_13 far beyond the wallet's own rule list.
 */
const EXCEPT_CLEAR_WALLET_NAME = 'onchainlabs';

/**
 * Aligns partner-wallet AML rules with the DFX partner baseline `3;7` and clears residual
 * `exceptAmlRules` overrides that would neutralise those rules (or rules arriving from other
 * sources).
 *
 * Problem: eleven partner wallets today carry either no tightening AML rule at all
 * (`amlRules = '0'`) or an active relaxation (RULE_14 — "no phoneCallCheck"), so their customers
 * can be assessed more leniently than DFX's own customers. Separately, the `onchainlabs` wallet
 * carries `exceptAmlRules = '13'`, which disables RULE_13 at every `amlRuleCheck` call site even
 * when the rule arrives via asset, IBAN country or nationality — far beyond the wallet's own
 * `amlRules = '3'`.
 *
 * Per-group semantics:
 *   - Name-matched baseline group (`BASELINE_WALLET_NAMES`): lift onto `amlRules = '3;7'` and pin
 *     `exceptAmlRules` to NULL in the same statement. RULE_3 requires KYC level 50; RULE_7 requires
 *     KYC level 50 for checkout/card payments — the set every DFX-owned wallet carries.
 *   - Id-matched baseline group (`BASELINE_WALLET_IDS`): same target write, but only when the row
 *     still carries the expected pre-state `'14'`. The guard prevents the id-match from rewriting
 *     unrelated wallets on non-PRD databases where these ids mean something else.
 *   - Except-clear group (`onchainlabs`): only `exceptAmlRules` is cleared; `amlRules` is left
 *     untouched because `'3'` is a deliberate partner configuration.
 *
 * Matching rationale: names are used where they are stable, public identifiers. The two id-matched
 * wallets cannot be named in this repository (natural-person names), so they are addressed by id
 * with a pre-state guard; PRD postconditions still assert both ids reached the target so an
 * unexpected pre-state cannot pass silently.
 *
 * Not environment-gated on the write path: missing rows are a plain no-op outside PRD. The
 * postcondition is environment-gated — only PRD is required to contain every targeted wallet.
 *
 * up():
 *   1. baseline leg — audit-then-update via data-modifying CTEs: lock matching wallet rows, insert
 *      a before/after audit log row, then update only if the audit insert succeeded (fail-closed)
 *   2. except-clear leg — same audit-then-update pattern, but only clears `exceptAmlRules` and
 *      deliberately omits amlRules keys from the audit payload
 *   3. postcondition: no name-matched or onchainlabs row may be left off the target configuration,
 *      and on PRD every expected name/id/onchainlabs row must actually exist at the target — a
 *      rename or unexpected pre-state would otherwise turn this migration into a silent no-op that
 *      still records itself as executed; an id-matched row left at the RULE_14 pre-state is
 *      rejected in every environment, not only PRD, because a successful id-matched update is never
 *      optional
 *
 * The update is skipped when the row already matches (`IS DISTINCT FROM` / pre-state guard / NULL
 * check), which makes the migration idempotent: a rerun finds empty "affected" sets, so the audit
 * `HAVING` clauses suppress the inserts and the UPDATEs change nothing.
 *
 * down() is a deliberate no-op: restoring the previous, weaker rule set is the dangerous direction
 * for an AML configuration, and it would also overwrite any rules set independently after up() ran.
 * The exact previous value of every changed row stays available in the up() audit log line (same
 * rationale as AlignBitagentWalletAmlRules / DeactivateTradingRules).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AlignPartnerWalletAmlBaseline1786127154000 {
  name = 'AlignPartnerWalletAmlBaseline1786127154000';

  /**
   * Writes the DFX partner AML baseline onto the listed partner wallets, clears the onchainlabs
   * exceptAmlRules override, and asserts the resulting state.
   *
   * EXISTS (SELECT 1 FROM "audit") fail-closes each UPDATE to its audit INSERT: if the insert
   * fails, no row is changed (CONTRIBUTING.md "Auditable mutations — no destructive overwrites
   * (CRITICAL)", before→after audit before the update).
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Baseline leg: name-matched wallets off target, plus id-matched wallets still on RULE_14.
    await queryRunner.query(
      `
WITH "affected" AS (
  SELECT "id", "amlRules", "exceptAmlRules" FROM "wallet"
  WHERE (
    "name" = ANY($2::varchar[])
    AND ("amlRules" IS DISTINCT FROM $1::varchar OR "exceptAmlRules" IS NOT NULL)
  ) OR (
    "id" = ANY($3::int[])
    AND "amlRules" = $4::varchar
  )
  FOR UPDATE
),
"audit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'Migration', 'AlignPartnerWalletAmlBaseline1786127154000', 'Info',
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
      [TARGET_AML_RULES, BASELINE_WALLET_NAMES, BASELINE_WALLET_IDS, REQUIRED_CURRENT_AML_RULES],
    );

    // Except-clear leg: only onchainlabs; amlRules deliberately untouched.
    await queryRunner.query(
      `
WITH "affected" AS (
  SELECT "id", "exceptAmlRules" FROM "wallet"
  WHERE "name" = $1::varchar AND "exceptAmlRules" IS NOT NULL
  FOR UPDATE
),
"audit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'Migration', 'AlignPartnerWalletAmlBaseline1786127154000', 'Info',
    json_agg(json_build_object(
      'walletId', "id",
      'previousExceptAmlRules', "exceptAmlRules",
      'nextExceptAmlRules', NULL::varchar
    ))::text
  FROM "affected"
  HAVING count(*) > 0
  RETURNING 1
)
UPDATE "wallet" w
SET "exceptAmlRules" = NULL, "updated" = now()
FROM "affected" a
WHERE w."id" = a."id" AND EXISTS (SELECT 1 FROM "audit");
`,
      // Trailing comma: a single-element array literal with one bare identifier would trip
      // migration-psql-check's MSSQL bracket-quoting guard, which cannot tell JS arrays from
      // MSSQL-quoted identifiers.
      [EXCEPT_CLEAR_WALLET_NAME,],
    );

    // Postcondition, not decoration: without it a suppressed audit insert, a concurrent edit, a
    // renamed wallet or an unexpected id pre-state would all leave the lenient configuration in
    // place while the migration records itself as executed.
    // `.at(0)` rather than array destructuring or an index access: the repo's MSSQL-syntax guard
    // (migration-psql-check.spec.ts) rejects bracket-quoted identifiers anywhere in a migration
    // file and cannot tell them apart from JavaScript brackets, and every other migration that
    // reads a single row reads it this way.
    const state = (
      await queryRunner.query(
        `
SELECT
  count(*) FILTER (
    WHERE "name" = ANY($2::varchar[])
      AND ("amlRules" IS DISTINCT FROM $1::varchar OR "exceptAmlRules" IS NOT NULL)
  )::int AS "nameDriftCount",
  count(*) FILTER (
    WHERE "name" = $3::varchar AND "exceptAmlRules" IS NOT NULL
  )::int AS "exceptDriftCount",
  count(DISTINCT "name") FILTER (
    WHERE "name" = ANY($2::varchar[])
  )::int AS "namePresentCount",
  count(*) FILTER (
    WHERE "id" = ANY($4::int[])
      AND "amlRules" = $1::varchar
      AND "exceptAmlRules" IS NULL
  )::int AS "idAtTargetCount",
  count(*) FILTER (
    WHERE "id" = ANY($4::int[]) AND "amlRules" = $5::varchar
  )::int AS "idDriftCount",
  count(*) FILTER (
    WHERE "name" = $3::varchar
  )::int AS "exceptWalletPresentCount"
FROM "wallet"
`,
        [
          TARGET_AML_RULES,
          BASELINE_WALLET_NAMES,
          EXCEPT_CLEAR_WALLET_NAME,
          BASELINE_WALLET_IDS,
          REQUIRED_CURRENT_AML_RULES,
        ],
      )
    ).at(0);

    if (state.nameDriftCount > 0)
      throw new Error(
        `AlignPartnerWalletAmlBaseline: ${state.nameDriftCount} named partner wallet(s) did not reach amlRules '${TARGET_AML_RULES}' with an empty exceptAmlRules`,
      );

    if (state.exceptDriftCount > 0)
      throw new Error(
        `AlignPartnerWalletAmlBaseline: ${state.exceptDriftCount} '${EXCEPT_CLEAR_WALLET_NAME}' wallet(s) still have a non-empty exceptAmlRules`,
      );

    // A row that matched the id guard must have been updated in every environment — a remaining
    // '14' means the audit insert was suppressed or the update otherwise failed, and that must
    // fail loudly everywhere, not only on PRD (rows at other values on foreign databases stay
    // tolerated outside PRD via the existing PRD-only target assert).
    if (state.idDriftCount > 0)
      throw new Error(
        `AlignPartnerWalletAmlBaseline: ${state.idDriftCount} id-matched wallet(s) still carry the ` +
          `RULE_14 pre-state after the update`,
      );

    // Only PRD is asserted to contain every targeted wallet: dev/loc/CI legitimately have no
    // partner wallets, and the id-match is only meaningful on the database the ids were read from.
    if (process.env.ENVIRONMENT === 'prd') {
      if (state.namePresentCount !== BASELINE_WALLET_NAMES.length)
        throw new Error(
          `AlignPartnerWalletAmlBaseline: expected ${BASELINE_WALLET_NAMES.length} named partner wallets on PRD, found ${state.namePresentCount} — the AML baseline alignment was not fully applied`,
        );

      if (state.idAtTargetCount !== BASELINE_WALLET_IDS.length)
        throw new Error(
          `AlignPartnerWalletAmlBaseline: expected ${BASELINE_WALLET_IDS.length} id-matched partner wallet(s) at amlRules '${TARGET_AML_RULES}' with empty exceptAmlRules on PRD, found ${state.idAtTargetCount}`,
        );

      if (state.exceptWalletPresentCount === 0)
        throw new Error(
          `AlignPartnerWalletAmlBaseline: no wallet named '${EXCEPT_CLEAR_WALLET_NAME}' found on PRD — the exceptAmlRules clear was not applied`,
        );
    }
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
