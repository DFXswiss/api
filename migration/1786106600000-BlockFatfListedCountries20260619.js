/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Blocks five FATF-listed countries that production still allows as of 2026-07-27.
 *
 * WHY: FATF grey-list snapshot of 2026-06-19 (June 2026 plenary, Paris) includes CD, KW, PG, BA
 * and IQ. Production currently leaves all five with fatfEnable=true (and BA also dfxEnable=true),
 * so they pass the public country DTO and AML FATF checks. This migration aligns those five rows
 * with the established DFX FATF-block pattern: fatfEnable=false, dfxEnable=false,
 * nationalityStepEnable=false.
 *
 * Effective date: 2026-06-19.
 *
 * FATF sources:
 * - https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html
 * - https://www.fatf-gafi.org/en/publications/High-risk-and-other-monitored-jurisdictions/increased-monitoring-june-2026.html
 *
 * Target matrix (only these symbols, only these three columns):
 * | symbol | fatfEnable | dfxEnable | nationalityStepEnable |
 * | CD     | false      | false     | false                 |
 * | KW     | false      | false     | false                 |
 * | PG     | false      | false     | false                 |
 * | BA     | false      | false     | false                 |
 * | IQ     | false      | false     | false                 |
 *
 * Over-blocks deliberately untouched: BF, MZ, NG, ZA, DZ, NA, CG remain blocked even though they
 * are not on the current FATF lists. Unblocking is a separate compliance decision. Consequence:
 * both Congos stay blocked (CG over-block preserved, CD newly correctly blocked).
 *
 * Other columns (bankEnable, checkoutEnable, cryptoEnable, ipEnable, ...) are not modified.
 * Panama (PA) is not FATF-listed and is not touched.
 *
 * Idempotency: audit INSERT and UPDATE share the predicate
 *   symbol in target set AND (fatfEnable OR dfxEnable OR nationalityStepEnable).
 * A second run matches zero rows, writes no log rows, and leaves updated timestamps alone.
 *
 * Empty-table guard: on a fresh local DB migrations run before seed; count=0 is a clean no-op so
 * the identity check does not abort boot. Seed then loads the matching snapshot.
 *
 * Audit: previous flags are written to the append-only "log" table before the snapshot UPDATE
 * (CONTRIBUTING.md — Auditable mutations). Category FatfSnapshot20260619.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BlockFatfListedCountries202606191786106600000 {
  name = 'BlockFatfListedCountries202606191786106600000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
            DO $$
            DECLARE
                total_countries integer;
                found_count integer;
                audit_count integer;
                changed_count integer;
                remaining_open integer;
                sym text;
                target_symbols text[] := ARRAY['BA', 'CD', 'IQ', 'KW', 'PG'];
                fatf_source text := 'https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html';
                migration_name text := 'BlockFatfListedCountries202606191786106600000';
            BEGIN
                SELECT count(*) INTO total_countries FROM "country";
                IF total_countries = 0 THEN
                    RAISE NOTICE 'BlockFatfListedCountries20260619: country table empty (fresh local setup before seed); skipping as no-op';
                    RETURN;
                END IF;

                FOREACH sym IN ARRAY target_symbols
                LOOP
                    SELECT count(*) INTO found_count FROM "country" WHERE "symbol" = sym;
                    IF found_count <> 1 THEN
                        RAISE EXCEPTION 'BlockFatfListedCountries20260619 identity check failed for symbol %: expected 1 row, found %',
                            sym, found_count;
                    END IF;
                END LOOP;

                INSERT INTO "log" ("system", "subsystem", "severity", "message", "category", "valid")
                SELECT
                    'Compliance',
                    'CountryPolicy',
                    'Info',
                    json_build_object(
                        'action', 'fatfPolicySnapshot',
                        'migration', migration_name,
                        'effectiveDate', '2026-06-19',
                        'source', fatf_source,
                        'countryId', c."id",
                        'symbol', c."symbol",
                        'previous', json_build_object(
                            'fatfEnable', c."fatfEnable",
                            'dfxEnable', c."dfxEnable",
                            'nationalityStepEnable', c."nationalityStepEnable"
                        ),
                        'next', json_build_object(
                            'fatfEnable', false,
                            'dfxEnable', false,
                            'nationalityStepEnable', false
                        ),
                        'changedFields', array_remove(ARRAY[
                            CASE WHEN c."fatfEnable" THEN 'fatfEnable' END,
                            CASE WHEN c."dfxEnable" THEN 'dfxEnable' END,
                            CASE WHEN c."nationalityStepEnable" THEN 'nationalityStepEnable' END
                        ], NULL)
                    )::text,
                    'FatfSnapshot20260619',
                    true
                FROM "country" c
                WHERE c."symbol" = ANY (target_symbols)
                  AND (c."fatfEnable" OR c."dfxEnable" OR c."nationalityStepEnable");
                GET DIAGNOSTICS audit_count = ROW_COUNT;

                UPDATE "country" c
                SET
                    "fatfEnable" = false,
                    "dfxEnable" = false,
                    "nationalityStepEnable" = false,
                    "updated" = NOW()
                WHERE c."symbol" = ANY (target_symbols)
                  AND (c."fatfEnable" OR c."dfxEnable" OR c."nationalityStepEnable");
                GET DIAGNOSTICS changed_count = ROW_COUNT;

                IF changed_count <> audit_count THEN
                    RAISE EXCEPTION 'BlockFatfListedCountries20260619 audit/update mismatch: audit_count=% <> changed_count=%',
                        audit_count, changed_count;
                END IF;

                SELECT count(*) INTO remaining_open
                FROM "country"
                WHERE "symbol" = ANY (target_symbols)
                  AND ("fatfEnable" OR "dfxEnable" OR "nationalityStepEnable");
                IF remaining_open <> 0 THEN
                    RAISE EXCEPTION 'BlockFatfListedCountries20260619 post-condition failed: % target row(s) still have an open flag',
                        remaining_open;
                END IF;

                RAISE NOTICE 'BlockFatfListedCountries20260619 complete: audit_count=%, changed_count=%',
                    audit_count, changed_count;
            END $$;
        `);
  }

  /**
   * @param {QueryRunner} _queryRunner
   */
  async down(_queryRunner) {
    // Intentionally empty: compliance country blocks are not rolled back. A migration down would
    // silently restore a laxer, outdated country allow-list. Reversal requires a new, compliance-
    // reviewed forward migration.
  }
};
