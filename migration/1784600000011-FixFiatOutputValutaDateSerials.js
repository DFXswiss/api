/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixFiatOutputValutaDateSerials1784600000011 {
  name = 'FixFiatOutputValutaDateSerials1784600000011';

  /**
   * Spreadsheet date serials were sent as numbers and class-transformer interpreted them as
   * milliseconds since 1970-01-01, yielding broken 1970 timestamps. The millisecond portion equals
   * the original serial (days since 1899-12-30); conversion is deterministic within the serial
   * window for dates from 2000-01-01 (serial 36526) to the observed maximum (serial ~46300 /
   * 1970-01-01 00:00:46.300):
   * "valutaDate" >= TIMESTAMP '1970-01-01 00:00:36.526' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300'
   * Known 1970-01-01T00:00:00.001Z legacy values exist only in "isReadyDate", never in "valutaDate",
   * and lie outside this window (no overlap).
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Audit before and after values per row (same transaction; fail closed if insert fails).
    await queryRunner.query(`
INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
SELECT
  now(),
  now(),
  'FiatOutput',
  'ValutaDateSerialRepair',
  'Info',
  json_agg(json_build_object(
    'id', "id",
    'before', to_char("valutaDate", 'YYYY-MM-DD HH24:MI:SS.MS'),
    'after', to_char(
      TIMESTAMP '1899-12-30 00:00:00' + ROUND(EXTRACT(EPOCH FROM "valutaDate") * 1000) * INTERVAL '1 day',
      'YYYY-MM-DD HH24:MI:SS.MS'
    )
  ))::text
FROM "fiat_output"
WHERE "valutaDate" >= TIMESTAMP '1970-01-01 00:00:36.526' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300'
HAVING count(*) > 0;
`);

    // Millisecond epoch offset is the spreadsheet serial; add that many days to 1899-12-30.
    await queryRunner.query(`
UPDATE "fiat_output"
SET "valutaDate" = TIMESTAMP '1899-12-30 00:00:00' + ROUND(EXTRACT(EPOCH FROM "valutaDate") * 1000) * INTERVAL '1 day'
WHERE "valutaDate" >= TIMESTAMP '1970-01-01 00:00:36.526' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300';
`);
  }

  /**
   * Restore previous "valutaDate" values exclusively from the newest audit log entry written by
   * up() (system='FiatOutput', subsystem='ValutaDateSerialRepair'). No calendar-date or midnight
   * heuristic: legitimate production valutaDates frequently are exactly midnight UTC
   * (00:00:00.000), so a date_trunc/midnight check would falsely reverse thousands of valid rows.
   * Missing audit log yields a no-op (0 rows).
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
UPDATE "fiat_output" f
SET "valutaDate" = (a.elem->>'before')::timestamp
FROM (
  SELECT jsonb_array_elements(l."message"::jsonb) AS elem
  FROM (
    SELECT "message" FROM "log"
    WHERE "system" = 'FiatOutput' AND "subsystem" = 'ValutaDateSerialRepair'
    ORDER BY "id" DESC LIMIT 1
  ) l
) a
WHERE f."id" = (a.elem->>'id')::int;
`);
  }
};
