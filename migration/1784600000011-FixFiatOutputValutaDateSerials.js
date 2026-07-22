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
   * Spreadsheet date serials (~45900–46225) were sent as numbers and class-transformer
   * interpreted them as milliseconds since 1970-01-01, yielding broken 1970 timestamps.
   * The millisecond portion equals the original serial (days since 1899-12-30); conversion
   * is deterministic within the serial window:
   * "valutaDate" >= TIMESTAMP '1970-01-01 00:00:45.900' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300'
   * (does not touch unrelated 1970-01-01T00:00:00.001Z rows).
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Audit previous values before update (same transaction; fail closed if insert fails).
    await queryRunner.query(`
INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
SELECT
  now(),
  now(),
  'FiatOutput',
  'ValutaDateSerialRepair',
  'Info',
  json_agg(json_build_object('id', "id", 'before', to_char("valutaDate", 'YYYY-MM-DD HH24:MI:SS.MS')))::text
FROM "fiat_output"
WHERE "valutaDate" >= TIMESTAMP '1970-01-01 00:00:45.900' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300'
HAVING count(*) > 0;
`);

    // Millisecond epoch offset is the spreadsheet serial; add that many days to 1899-12-30.
    await queryRunner.query(`
UPDATE "fiat_output"
SET "valutaDate" = TIMESTAMP '1899-12-30 00:00:00' + ROUND(EXTRACT(EPOCH FROM "valutaDate") * 1000) * INTERVAL '1 day'
WHERE "valutaDate" >= TIMESTAMP '1970-01-01 00:00:45.900' AND "valutaDate" < TIMESTAMP '1970-01-01 00:00:46.300';
`);
  }

  /**
   * Reverse only repaired midnight UTC values in the calendar window for serials 45900–46300
   * (1899-12-30 + 45900 days = 2025-08-31; 1899-12-30 + 46300 days = 2026-10-05).
   * Legitimate valutaDates use 22:00/23:00 UTC and are excluded via date_trunc equality.
   * Audit log row from up() is left in place.
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
UPDATE "fiat_output"
SET "valutaDate" = TIMESTAMP '1970-01-01 00:00:00' + ROUND(EXTRACT(EPOCH FROM ("valutaDate" - TIMESTAMP '1899-12-30 00:00:00')) / 86400) * INTERVAL '1 millisecond'
WHERE "valutaDate" >= TIMESTAMP '2025-08-31 00:00:00' AND "valutaDate" < TIMESTAMP '2026-10-05 00:00:00'
  AND date_trunc('day', "valutaDate") = "valutaDate";
`);
  }
};
